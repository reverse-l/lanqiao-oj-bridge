import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalProblemIndex, type LocalProblem} from '../src/local-problems';
import {LocalProblemFileStorage} from '../src/local-problem-storage';
import {importProblem} from '../src/storage';
import {validateProblem} from '../src/problem';

const problem = {
  version: 1 as const, id: '3008', title: '本地练习',
  url: 'https://www.lanqiao.cn/problems/3008/learning/', markdown: '', tests: [],
};
const courseUrl = 'https://www.lanqiao.cn/courses/71/learning/?id=123';
const key = 'lanqiao-oj:3008';
const courseKey = 'lanqiao-course:3008';
const source = path.resolve('main.cpp');

function memoryStorage() {
  let content = '[]';
  return {
    read: async (): Promise<unknown> => JSON.parse(content),
    write: async (records: LocalProblem[]) => { content = JSON.stringify(records); },
    withLock: <T>(action: () => Promise<T>) => action(),
  };
}

function verdict(status: string, created = 20, overrides = {}) {
  return {
    kind: 'submit', problemId: problem.id, state: 'finished', created,
    result: {phase: 'done', status, submissionId: `receipt-${created}`}, ...overrides,
  };
}

test('重复导入、并发标签编辑和正式评测合并后，重启仍保留标签、路径及通过记录', async () => {
  const state = memoryStorage();
  const index = new LocalProblemIndex(state);
  await index.upsert(problem, source);
  assert.equal(index.get(key)?.status, 'not_submitted');
  const importedAt = index.get(key)?.importedAt;
  await Promise.all([
    index.setTags(key, [' DFS ', '图论', 'dfs', '']),
    index.recordResult(verdict('AC')),
    index.upsert({...problem, title: '标题已更新'}, source),
  ]);
  assert.equal(index.get(key)?.status, 'accepted');
  await index.recordResult(verdict('WA', 30));
  await index.recordResult(verdict('TLE', 25));
  const restored = new LocalProblemIndex(state);
  await restored.reload();
  assert.equal(restored.list().length, 1);
  assert.equal(restored.get(key)?.status, 'wrong_answer');
  assert.equal(restored.get(key)?.lastAcceptedAt, 20);
  assert.equal(restored.get(key)?.lastSubmittedAt, 30);
  assert.deepEqual(restored.get(key)?.tags, ['DFS', '图论']);
  assert.equal(restored.get(key)?.localFilePath, source);
  assert.equal(restored.get(key)?.title, '标题已更新');
  assert.equal(restored.get(key)?.importedAt, importedAt);
});

test('只接收有凭据的最终正式评测，按来源归属，同号旧结果不猜测', async () => {
  const index = new LocalProblemIndex(memoryStorage());
  await index.upsert(problem, source);
  for (const result of [
    verdict('AC', 20, {kind: 'debug'}), verdict('AC', 20, {kind: 'local'}),
    verdict('AC', 20, {state: 'claimed'}), verdict('AC', 20, {state: 'expired'}),
    verdict('AC', 20, {result: {phase: 'unknown', status: 'AC', submissionId: 'receipt'}}),
    verdict('AC', 20, {result: {phase: 'done', status: 'AC'}}),
    verdict('AC', 20, {result: {phase: 'done', message: '通过', submissionId: 'receipt'}}),
  ]) await index.recordResult(result);
  assert.equal(index.get(key)?.status, 'not_submitted');
  await index.upsert({...problem, courseUrl}, source);
  await index.recordResult(verdict('AC'));
  assert.equal(index.get(key)?.status, 'not_submitted');
  assert.equal(index.get(courseKey)?.status, 'not_submitted');
  await index.recordResult(verdict('TLE', 25, {problemSource: 'lanqiao-course'}));
  assert.equal(index.get(courseKey)?.status, 'time_limit_exceeded');
  assert.equal(index.get(courseKey)?.sourceUrl, courseUrl);
  assert.equal(index.get(key)?.status, 'not_submitted');
  for (const [i, [official, expected]] of Object.entries({MLE: 'memory_limit_exceeded', RE: 'runtime_error', CE: 'compile_error', PE: 'other'}).entries()) {
    await index.recordResult(verdict(official, 30 + i, {problemSource: 'lanqiao-oj'}));
    assert.equal(index.get(key)?.status, expected);
  }
});

test('旧目录迁移只登记有效题目和已有源码，复用记录及缓存的官方结果', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-index-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const template = path.join(root, 'template.cpp');
  await writeFile(template, 'int main() {}\n');
  const imported = await importProblem(root, template, problem);
  const broken = await importProblem(root, template, {...problem, id: '3009', url: problem.url.replace('3008', '3009')});
  await rm(broken.source);
  const index = new LocalProblemIndex(memoryStorage());
  assert.deepEqual(await index.importExisting(root, () => 'c', [verdict('AC')]), {found: 1, added: 1, skipped: 1});
  assert.equal(index.get(key)?.localFilePath, imported.source);
  assert.equal(index.get(key)?.status, 'accepted');
  await index.setTags(key, ['二分']);
  assert.equal((await index.importExisting(root, () => 'cpp', [])).added, 0);
  assert.deepEqual(index.get(key)?.tags, ['二分']);
  assert.equal(await readFile(imported.source, 'utf8'), 'int main() {}\n');
});

test('课程来源链接只保留官方页面和数字单元号，不保存查询附带内容', () => {
  assert.equal(validateProblem({...problem, courseUrl: courseUrl + '&token=discard#fragment'}).courseUrl, courseUrl);
  for (const url of [courseUrl.replace('www.lanqiao.cn', 'example.test'), courseUrl + '&id=456', courseUrl.replace('123', 'text')]) {
    assert.throws(() => validateProblem({...problem, courseUrl: url}), /课程/);
  }
});

test('旧脚本重复导入同一个课程目录沿用来源，显式题库导入才单独登记', async () => {
  const index = new LocalProblemIndex(memoryStorage());
  await index.upsert({...problem, courseUrl}, source);
  await index.setTags(courseKey, ['课程笔记']);
  const repeated = await index.upsert(problem, source);
  assert.equal(repeated.key, courseKey);
  assert.deepEqual(repeated.tags, ['课程笔记']);
  assert.equal(index.list().length, 1);
  await index.upsert({...problem, source: 'lanqiao-oj'}, source);
  assert.equal(index.list().length, 2);
});

test('源码目录移动并留下符号链接时，重新导入可修复失效路径', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-moved-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const template = path.join(root, 'template.cpp');
  await writeFile(template, 'int main() {}\n');
  const imported = await importProblem(path.join(root, 'before'), template, problem, '', 'cpp', undefined, {naming: 'main'});
  const moved = path.join(root, 'after');
  const index = new LocalProblemIndex(memoryStorage());
  await index.upsert(problem, imported.source);
  await rename(path.join(root, 'before'), moved);
  await symlink(moved, path.join(root, 'before'), process.platform === 'win32' ? 'junction' : 'dir');
  const source = path.join(moved, path.basename(imported.directory), 'main.cpp');
  await index.upsert(problem, source);
  assert.equal(index.get(key)?.localFilePath, source);
});

test('多个窗口并发编辑不同记录时，磁盘事务保留两次写入，历史可以修复已存在的记录', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-multi-window-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const a = new LocalProblemIndex(new LocalProblemFileStorage(root));
  const b = new LocalProblemIndex(new LocalProblemFileStorage(root));
  await Promise.all([a.upsert(problem, source), b.upsert({...problem, id: '3009', url: problem.url.replace('3008', '3009')}, source)]);
  await Promise.all([a.setTags(key, ['DFS']), b.setTags('lanqiao-oj:3009', ['二分'])]);
  const c = new LocalProblemIndex(new LocalProblemFileStorage(root));
  await c.reload();
  assert.deepEqual(c.list().map(item => item.tags).flat().sort(), ['DFS', '二分']);
  await c.reconcile([verdict('AC')]);
  const accepted = c.get(key);
  await c.reconcile([verdict('AC')]);
  assert.equal(c.get(key), accepted);
  assert.equal(c.get(key)?.status, 'accepted');
});
