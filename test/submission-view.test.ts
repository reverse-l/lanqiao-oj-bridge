import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';

type Uri = {scheme: string; path: string; fsPath?: string};
type Pick = {label: string; description?: string; detail?: string};

async function setup(currentProblemKey?: () => Promise<string | undefined>) {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-submission-view-'));
  const currentC = path.join(directory, 'main.c');
  const key = 'lanqiao-oj:3008';
  const first = {id: 'first', problemKey: key, createdAt: 1000, language: 'c',
    sourcePath: path.join(directory, 'moved', 'main.c'), status: 'wrong_answer', officialStatus: 'WA', submissionId: '201', codeHash: 'abc'};
  const latest = {...first, id: 'latest', createdAt: 2000, status: 'accepted', officialStatus: 'AC', submissionId: '202'};
  await writeFile(currentC, 'int main(void) { return 2; }\n');

  const commands = new Map<string, (target?: unknown) => Promise<void>>();
  const snapshots = [latest, first];
  const reviews = new Map<string, string>();
  const missingCode = new Set<string>();
  const confirmations: string[] = [];
  const errors: string[] = [];
  const information: string[] = [];
  const picks: Array<readonly Pick[]> = [];
  const choices: number[] = [];
  const opened: Array<Uri | string> = [];
  const diffs: Array<{left: Uri; right: Uri; title: string}> = [];
  const cleaned: number[] = [];
  let confirm = false;
  let scheme = '';
  let provider!: {provideTextDocumentContent(uri: Uri): Promise<string>};
  const disposable = {dispose() {}};
  const vscode = {
    Uri: {from: (uri: Uri) => uri, file: (file: string) => ({scheme: 'file', path: file, fsPath: file})},
    workspace: {
      getConfiguration: () => ({get: () => 1}),
      registerTextDocumentContentProvider(id: string, value: typeof provider) { scheme = id; provider = value; return disposable; },
      async openTextDocument(uri: Uri | string) {
        if (typeof uri === 'object' && uri.scheme === scheme) await provider.provideTextDocumentContent(uri);
        return {uri};
      },
    },
    commands: {
      registerCommand(id: string, run: (target?: unknown) => Promise<void>) {commands.set(id, run); return disposable;},
      async executeCommand(id: string, left: Uri, right: Uri, title: string) {
        assert.equal(id, 'vscode.diff');
        diffs.push({left, right, title});
      },
    },
    window: {
      async showQuickPick(items: readonly Pick[]) { picks.push(items); return items[choices.shift() ?? -1]; },
      async showErrorMessage(message: string) { errors.push(message); },
      async showInformationMessage(message: string) { information.push(message); },
      async showWarningMessage(message: string, options: {modal: boolean}, action: string) {
        assert.equal(options.modal, true);
        confirmations.push(message);
        return confirm ? action : undefined;
      },
      async showTextDocument(document: {uri: Uri | string}) { opened.push(document.uri); },
    },
  };
  const store = {
    list: (problemKey: string) => problemKey === key ? snapshots.slice() : [],
    get: (id: string) => snapshots.find(snapshot => snapshot.id === id),
    readCode: async (id: string) => {
      if (missingCode.has(id)) throw new Error('提交快照源码已丢失，可移除此快照记录');
      if (id === 'first') return 'int main(void) { return 1; }\n';
      if (id === 'latest') return 'int main(void) { return 0; }\n';
      throw new Error('快照不存在，请重新选择提交记录。');
    },
    async remove(id: string) { snapshots.splice(snapshots.findIndex(snapshot => snapshot.id === id), 1); },
    async clean(_problemKey: string, keep: number) { cleaned.push(keep); return 0; },
    listReviews: () => Array.from(reviews, ([problemKey, status]) => ({problemKey, status})),
    getReview: (problemKey: string) => reviews.has(problemKey) ? {problemKey, status: reviews.get(problemKey)} : undefined,
    async ensureReview(problemKey: string) { if (!reviews.has(problemKey)) reviews.set(problemKey, 'needs_review'); },
    async setReview(problemKey: string, status: string) { reviews.set(problemKey, status); },
    async noteFile() { return path.join(directory, 'review.md'); },
  };
  const indexed = {key, id: '3008', title: '三角形', localFilePath: path.join(directory, 'main.cpp')};
  const index = {get: (problemKey: string) => problemKey === key ? indexed : undefined, list: () => [indexed]};
  const result = await build({entryPoints: ['src/submission-view.ts'], bundle: true, format: 'cjs', platform: 'node', write: false,
    external: ['vscode']}).catch(async error => { await rm(directory, {recursive: true, force: true}); throw error; });
  const createModule = vm.runInThisContext(`(function(require, module){${result.outputFiles[0].text}\n})`);
  const module = {exports: {} as typeof import('../src/submission-view')};
  createModule((id: string) => id === 'vscode' ? vscode : require(id), module);
  module.exports.registerSubmissionCommands({subscriptions: []} as any, index as any, store as any, currentProblemKey ?? (async () => key));
  const run = (command: string, target?: unknown) => commands.get(`lanqiao.${command}`)!(target);
  return {key, first, latest, currentC, snapshots, errors, information, diffs, opened, picks, choices, confirmations, cleaned, reviews, missingCode, run,
    readVirtual: (uri: Uri) => provider.provideTextDocumentContent(uri),
    confirm: () => {confirm = true;},
    cleanup: () => rm(directory, {recursive: true, force: true})};
}

test('一键对比选用两份官方快照，并提示已打开的快照源码被删除', async t => {
  const h = await setup();
  t.after(h.cleanup);
  const target = {problemKey: h.key};
  h.first.status = 'time_limit_exceeded';
  h.snapshots.push({...h.first, id: 'older', createdAt: 500, status: 'wrong_answer'});
  await h.run('compareFailureToAccepted', target);
  const [diff] = h.diffs;
  assert.match(diff.title, /3008.*TLE.*AC/);
  assert.equal(diff.left.scheme, 'lanqiao-submission');
  assert.equal(diff.right.scheme, 'lanqiao-submission');
  assert.equal(await h.readVirtual(diff.left), 'int main(void) { return 1; }\n');
  assert.equal(await h.readVirtual(diff.right), 'int main(void) { return 0; }\n');
  h.missingCode.add(h.latest.id);
  await h.run('compareFailureToAccepted', target);
  assert.equal(h.diffs.length, 1);
  assert.match(h.errors[0], /快照源码已丢失/);
});

test('一键对比没有后续 AC 时使用实际同语言源码，仅有 AC 时提示', async t => {
  const h = await setup();
  t.after(h.cleanup);
  h.snapshots.splice(1, 1);
  await h.run('compareFailureToAccepted', h.key);
  assert.equal(h.information.at(-1), '该题没有可用于对比的失败提交记录。');
  assert.equal(h.diffs.length, 0);
  h.snapshots.push({...h.first, createdAt: 3000, status: 'time_limit_exceeded'});
  await h.run('compareFailureToAccepted', h.key);
  assert.match(h.diffs[0].title, /TLE.*当前 main\.c/);
  assert.equal(h.diffs[0].right.fsPath, h.currentC);
  assert.equal(await readFile(h.currentC, 'utf8'), 'int main(void) { return 2; }\n');
  await rm(h.currentC);
  await h.run('compareFailureToAccepted', h.key);
  assert.equal(h.diffs.length, 1);
  assert.match(h.errors[0], /找不到.*当前.*源码/);
});

test('与当前代码比较读取同语言的文件，历史一侧是独立的只读文档', async t => {
  const h = await setup();
  t.after(h.cleanup);
  await h.run('compareCurrentSubmission', {problemKey: h.key, snapshotId: h.latest.id});
  assert.deepEqual(h.errors, []);
  const [diff] = h.diffs;
  assert.equal(diff.right.fsPath, h.currentC);
  assert.notEqual(diff.left.scheme, 'file');
  assert.equal(await h.readVirtual(diff.left), 'int main(void) { return 0; }\n');
  assert.equal(await readFile(h.currentC, 'utf8'), 'int main(void) { return 2; }\n');
  await rm(h.currentC);
  await h.run('compareCurrentSubmission', {problemKey: h.key, snapshotId: h.latest.id});
  assert.equal(h.diffs.length, 1);
  assert.match(h.errors[0], /main\.c/);
});

test('旧 C 快照可对比当前目录的题号命名 C 源码', async t => {
  const h = await setup();
  t.after(h.cleanup);
  const numbered = path.join(path.dirname(h.currentC), '3008.c');
  await rm(h.currentC);
  await writeFile(numbered, 'int main(void) { return 3; }\n');
  await h.run('compareCurrentSubmission', {problemKey: h.key, snapshotId: h.first.id});
  assert.deepEqual(h.errors, []);
  assert.equal(h.diffs[0].right.fsPath, numbered);
});

test('没有可识别的活动题目时，从题目列表选择，快照源码缺失时给出修复提示', async t => {
  const h = await setup(async () => {throw new Error('当前编辑器没有题目');});
  t.after(h.cleanup);
  h.missingCode.add(h.latest.id);
  h.choices.push(0, 0);
  await h.run('submissionHistory');
  assert.match(h.picks[0]?.[0]?.label ?? '', /3008/);
  assert.match(h.errors[0], /快照源码已丢失.*移除/);
  assert.deepEqual(h.opened, []);
});

test('相邻快照按时间比较，任意两次快照可按指定顺序比较', async t => {
  const h = await setup();
  t.after(h.cleanup);
  await h.run('compareAdjacentSubmission', {problemKey: h.key, snapshotId: h.first.id});
  h.choices.push(0, 0);
  await h.run('compareSubmissions');
  assert.deepEqual(h.errors, []);
  assert.equal(h.diffs.length, 2);
  const compared = await Promise.all(h.diffs.map(diff => Promise.all([h.readVirtual(diff.left), h.readVirtual(diff.right)])));
  assert.deepEqual(compared, [
    ['int main(void) { return 1; }\n', 'int main(void) { return 0; }\n'],
    ['int main(void) { return 0; }\n', 'int main(void) { return 1; }\n'],
  ]);
  h.choices.push(0);
  await h.run('submissionHistory');
  assert.match(h.picks.at(-1)?.[0].description ?? '', /通过.*AC/);
  assert.deepEqual(h.opened, [h.diffs[0].right]);
});

test('删除和清理快照需要确认，复盘进度与评测结果各自保存', async t => {
  const h = await setup();
  t.after(h.cleanup);
  const target = {problemKey: h.key, snapshotId: h.first.id};
  await h.run('deleteSubmission', target);
  await h.run('cleanSubmissions', target);
  assert.equal(h.confirmations.length, 2);
  assert.equal(h.snapshots.length, 2);
  assert.deepEqual(h.cleaned, []);
  h.confirm();
  await h.run('cleanSubmissions', target);
  await h.run('deleteSubmission', target);
  assert.equal(h.snapshots.length, 1);
  assert.deepEqual(h.cleaned, [1]);
  await h.run('addReview', target);
  assert.equal(h.reviews.get(h.key), 'needs_review');
  h.choices.push(1);
  await h.run('setReviewStatus', target);
  assert.equal(h.reviews.get(h.key), 'reviewing');
  await h.run('editReviewNote', target);
  assert.match(JSON.stringify(h.opened), /review\.md/);
  await h.run('markReviewDone', target);
  assert.equal(h.reviews.get(h.key), 'reviewed');
  assert.equal(h.snapshots[0].status, 'accepted');
});
