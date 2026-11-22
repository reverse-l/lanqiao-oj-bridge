import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test, type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {selectReviewComparison, SubmissionStore, type SubmissionSnapshot} from '../src/submission-store';

const oj = 'lanqiao-oj:3010';
const course = 'lanqiao-course:3010';
const source = path.resolve('main.cpp');

async function storage(t: TestContext) {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-submissions-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return {directory, store: new SubmissionStore(directory)};
}

function submission(created = Date.now(), code = 'int main() {}\r\n// 提交代码\n') {
  return {id: randomUUID(), created, kind: 'submit', language: 'cpp' as const, code};
}

function final(id: string, status: string, submissionId?: string) {
  return {id, state: 'finished', result: {phase: 'done' as const, status, submissionId}};
}

test('复盘选择最近一次从失败到 AC 的过程，跳过未确认及重复通过的记录', () => {
  const snapshot = (createdAt: number, status: SubmissionSnapshot['status']): SubmissionSnapshot => ({
    id: String(createdAt), problemKey: oj, sourcePath: source, language: 'cpp', createdAt, status, codeHash: '',
    submissionId: String(createdAt),
  });
  const wa = snapshot(1, 'wrong_answer');
  const tle = snapshot(2, 'time_limit_exceeded');
  const ac = snapshot(3, 'accepted');
  const re = snapshot(4, 'runtime_error');
  const other = snapshot(5, 'other');
  const pending = snapshot(6, 'pending');
  const unconfirmed = {...snapshot(7, 'accepted'), submissionId: undefined};
  const laterAc = snapshot(8, 'accepted');
  const extraAc = snapshot(9, 'accepted');
  const latestCe = snapshot(10, 'compile_error');
  assert.deepEqual(selectReviewComparison([wa, ac, snapshot(NaN, 'wrong_answer'), tle]), {failed: tle, accepted: ac});
  assert.deepEqual(selectReviewComparison([latestCe, ac, pending, tle, extraAc, other, laterAc, unconfirmed, wa, re]),
    {failed: re, accepted: laterAc});
  assert.deepEqual(selectReviewComparison([tle, wa]), {failed: tle});
  assert.equal(selectReviewComparison([ac, unconfirmed, other]), undefined);
});

test('相同提交时间以持久化插入顺序确定配对，重启后顺序一致', async t => {
  const {directory, store} = await storage(t);
  const time = Date.now();
  const wa = {...submission(time), id: '00000000-0000-4000-8000-000000000003'};
  const tle = {...submission(time), id: '00000000-0000-4000-8000-000000000002'};
  const ac = {...submission(time), id: '00000000-0000-4000-8000-000000000001'};
  for (const job of [wa, tle, ac]) await store.create(job, oj, source, 20);
  await store.record(final(ac.id, 'AC', '3'));
  await store.record(final(tle.id, 'TLE', '2'));
  await store.record(final(wa.id, 'WA', '1'));
  const restarted = new SubmissionStore(directory);
  await restarted.reload();
  const items = restarted.list(oj);
  assert.deepEqual(items.map(item => item.id), [ac.id, tle.id, wa.id]);
  assert.equal(selectReviewComparison(items)?.failed.id, tle.id);
  assert.equal(selectReviewComparison(items)?.accepted?.id, ac.id);
  assert.equal(restarted.getReview(oj)?.lastFailure?.id, tle.id);
});

test('异常退出遗留锁可安全恢复，两个重新启动的窗口保留各自写入', async t => {
  const {directory, store} = await storage(t);
  const exited = spawn(process.execPath, ['-e', '']);
  await once(exited, 'exit');
  assert.ok(exited.pid);
  await writeFile(path.join(directory, 'submissions.json.lock'), `${exited.pid}:${randomUUID()}`);
  const second = new SubmissionStore(directory);
  const firstJob = submission(), secondJob = submission();
  await Promise.all([store.create(firstJob, oj, source, 20), second.create(secondJob, oj, source, 20)]);
  await store.reload();
  assert.equal(store.list(oj).length, 2);
  assert.equal(await store.readCode(firstJob.id), firstJob.code);
  assert.equal(await store.readCode(secondJob.id), secondJob.code);
});

test('两个窗口合并快照，重复登记不会覆盖已保存的提交代码', async t => {
  const {directory, store} = await storage(t);
  const second = new SubmissionStore(directory);
  const firstAttempt = submission(Date.now() - 1);
  const secondAttempt = submission();
  await Promise.all([store.create(firstAttempt, oj, source, 20), second.create(secondAttempt, oj, source, 20)]);
  await Promise.all([
    second.create({...firstAttempt, code: 'modified'}, oj, source, 20),
    store.create({...firstAttempt, code: undefined}, oj, source, 20),
  ]);
  const restored = new SubmissionStore(directory);
  await restored.reload();
  assert.deepEqual(restored.list(oj).map(item => item.id), [secondAttempt.id, firstAttempt.id]);
  assert.equal(await restored.readCode(firstAttempt.id), firstAttempt.code);
  assert.match(restored.get(firstAttempt.id)!.codeHash, /^[\da-f]{64}$/);
  assert.equal(restored.get(firstAttempt.id)?.sourcePath, source);
  for (const kind of ['debug', 'prepare']) await restored.create({...submission(), kind}, oj, source, 20);
  assert.equal(restored.list(oj).length, 2);
});

test('区分官方判定、未发送、未知和等待，保留来源及可用平台指标', async t => {
  const {directory, store} = await storage(t);
  for (const [official, status] of Object.entries({AC: 'accepted', ' wa ': 'wrong_answer', TLE: 'time_limit_exceeded', MLE: 'memory_limit_exceeded', RE: 'runtime_error', CE: 'compile_error', 'Output Limit Exceeded': 'other'})) {
    const job = submission();
    await store.create(job, oj, source, 20);
    assert.equal(store.get(job.id)?.status, 'pending');
    await store.record({id: job.id, state: 'claimed', result: {phase: 'accepted', submissionId: 'r-122'}}, course);
    assert.equal(store.get(job.id)?.status, 'pending');
    assert.equal(store.get(job.id)?.submissionId, 'r-122');
    await store.record({id: job.id, state: 'finished', result: {phase: 'done', status: official, submissionId: 'r-122', runtime: '12.5', memory: 1200, stderr: 'private result'}}, course);
    await store.record({id: job.id, state: 'claimed', result: {phase: 'sent'}}, oj);
    assert.deepEqual(store.get(job.id), {
      id: job.id, problemKey: course, createdAt: job.created, language: 'cpp', sourcePath: source,
      status, submissionId: 'r-122', officialStatus: official.trim(), durationMs: 12.5, memoryKb: 1200,
      codeHash: store.get(job.id)?.codeHash,
    });
  }
  const unsent = submission();
  const maybeSent = submission();
  const unverifiable = submission();
  const lostProgress = submission();
  const mismatched = submission();
  for (const job of [unsent, maybeSent, unverifiable, lostProgress, mismatched]) await store.create(job, oj, source, 20);
  await store.record({id: unsent.id, state: 'expired', result: {phase: 'error'}});
  await store.record({id: maybeSent.id, state: 'claimed', result: {phase: 'sent'}});
  await store.record({id: maybeSent.id, state: 'finished', result: {phase: 'error'}});
  await store.record(final(unverifiable.id, 'AC'));
  await store.record({id: lostProgress.id, state: 'finished', worker: 'browser', result: {phase: 'error'}});
  await store.record({id: mismatched.id, state: 'claimed', result: {phase: 'accepted', submissionId: 'actual'}});
  await store.record(final(mismatched.id, 'AC', 'different'));
  assert.equal(store.get(unsent.id)?.status, 'not_sent');
  assert.equal(store.get(maybeSent.id)?.status, 'unknown');
  assert.equal(store.get(unverifiable.id)?.status, 'unknown');
  assert.equal(store.get(lostProgress.id)?.status, 'unknown');
  assert.equal(store.get(mismatched.id)?.status, 'unknown');
  assert.equal(store.get(mismatched.id)?.submissionId, 'actual');
  assert.equal(store.get(unverifiable.id)?.officialStatus, undefined);
  assert.equal(store.getReview(oj), undefined);
  const metadata = (await readdir(directory)).find(name => name.endsWith('.json'))!;
  assert.doesNotMatch(await readFile(path.join(directory, metadata), 'utf8'), /private result|int main/);
});

test('保留最新版本和仍在进行的任务，删除快照后仍保留最近官方错题记录', async t => {
  const {directory, store} = await storage(t);
  const old = submission(Date.now() - 6_000);
  const failed = submission(Date.now() - 4_000);
  const latest = submission(Date.now() - 2_000);
  for (const job of [old, failed, latest]) await store.create(job, oj, source, 20);
  await store.record(final(failed.id, 'WA', 'r-wa'));
  await store.setReview(oj, 'reviewed');
  const reviewedAt = store.getReview(oj)?.reviewedAt;
  await store.record(final(latest.id, 'AC', 'r-ac'));
  await assert.rejects(store.remove(old.id), /进行|等待/);
  assert.equal(await store.clean(oj, 0), 1);
  assert.deepEqual(store.list(oj).map(item => item.id), [latest.id, old.id]);
  await store.record(final(old.id, 'TLE', 'r-tle'));
  await store.remove(latest.id);
  const restored = new SubmissionStore(directory);
  await restored.reload();
  assert.deepEqual(restored.listReviews(), [{problemKey: oj, status: 'reviewed', reviewedAt, lastFailure: {id: failed.id, at: failed.created, status: 'wrong_answer'}}]);
  await assert.rejects(restored.readCode(failed.id), /快照/);
});

test('重新加载仍在期限内的任务保持等待，过期任务显示未知并仍可接收正式判定', async t => {
  const {directory, store} = await storage(t);
  const active = submission();
  const expired = submission(Date.now() - 180_001);
  await store.create(active, oj, source, 20);
  await store.create(expired, oj, source, 20);
  const restored = new SubmissionStore(directory);
  await restored.reload();
  assert.equal(restored.get(active.id)?.status, 'pending');
  assert.equal(restored.get(expired.id)?.status, 'unknown');
  assert.equal(await restored.readCode(expired.id), expired.code);
  await restored.record(final(expired.id, 'AC', 'r-late'));
  assert.equal(restored.get(expired.id)?.status, 'accepted');
});

test('损坏的索引保留原文件和当前列表，快照代码丢失时给出可操作提示', async t => {
  const {directory, store} = await storage(t);
  const job = submission();
  await store.create(job, oj, source, 20);
  const files = await readdir(directory, {recursive: true});
  const index = path.join(directory, files.find(name => name.endsWith('.json'))!);
  const code = path.join(directory, files.find(name => path.basename(name).startsWith(job.id))!);
  await rm(code);
  await assert.rejects(store.readCode(job.id), /源码.*(丢失|不存在)/);
  await writeFile(index, '{corrupt');
  await assert.rejects(store.reload(), /索引/);
  await assert.rejects(store.setReview(oj, 'reviewing'), /索引/);
  assert.equal(store.get(job.id)?.status, 'pending');
  assert.equal(await readFile(index, 'utf8'), '{corrupt');
  await assert.rejects(store.noteFile('../../main.cpp'), /题目/);
});

test('恢复只写入源码的快照时校验原字节，清理不删除替换过的本地文件', async t => {
  const {directory, store} = await storage(t);
  const job = submission();
  await store.create(job, oj, source);
  const files = await readdir(directory, {recursive: true});
  const code = path.join(directory, files.find(name => path.basename(name).startsWith(job.id))!);
  const pending = submission();
  const orphan = code.replace(job.id, pending.id);
  await writeFile(orphan, '其他本地文件');
  await assert.rejects(store.create(pending, oj, source), /不一致/);
  assert.equal(await readFile(orphan, 'utf8'), '其他本地文件');
  await writeFile(orphan, pending.code);
  await store.create(pending, oj, source);
  assert.equal(await store.readCode(pending.id), pending.code);
  await store.record(final(job.id, 'AC', 'r-ac'));
  await writeFile(code, '用户编辑过的文件');
  await assert.rejects(store.readCode(job.id), /完整性校验/);
  await store.remove(job.id);
  assert.equal(await readFile(code, 'utf8'), '用户编辑过的文件');
});

test('复盘笔记以来源区分，仅首次创建，拒绝符号链接和目录', async t => {
  const {store} = await storage(t);
  await store.ensureReview(oj);
  await store.setReview(oj, 'reviewing');
  await store.ensureReview(oj);
  assert.equal(store.getReview(oj)?.status, 'reviewing');
  const note = await store.noteFile(oj);
  assert.match(await readFile(note, 'utf8'), /## 错因\n\n## 知识点\n\n## 思路\n\n## 总结\n/);
  await writeFile(note, '自定义复盘笔记');
  assert.equal(await store.noteFile(oj), note);
  assert.equal(await readFile(note, 'utf8'), '自定义复盘笔记');
  const otherNote = await store.noteFile(course);
  assert.notEqual(otherNote, note);
  await rm(otherNote);
  if (process.platform !== 'win32') {
    await symlink(note, otherNote);
    await assert.rejects(store.noteFile(course), /符号链接|普通文件/);
    await rm(otherNote);
  }
  await mkdir(otherNote);
  await assert.rejects(store.noteFile(course), /普通文件/);
});

test('其他窗口写入后自动重新加载，监听可以释放', async t => {
  const {directory, store} = await storage(t);
  const writer = new SubmissionStore(directory);
  const errors: unknown[] = [];
  const watcher = await store.watchChanges(error => errors.push(error));
  t.after(() => watcher.dispose());
  let changes = 0;
  const unsubscribe = store.onChange(() => { changes++; });
  await writer.ensureReview(oj);
  for (let i = 0; i < 40 && !changes; i++) await delay(25);
  assert.equal(store.getReview(oj)?.status, 'needs_review');
  assert.ok(changes > 0);
  assert.deepEqual(errors, []);
  unsubscribe();
  const observed = changes;
  await store.setReview(oj, 'reviewed');
  assert.equal(changes, observed);
});
