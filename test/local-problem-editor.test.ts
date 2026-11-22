import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, realpath, rm, stat, writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {build} from 'esbuild';
import {LocalProblemIndex, type LocalProblem} from '../src/local-problems';

const bundle = build({entryPoints: ['src/local-problem-editor.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'], logLevel: 'silent'});
async function setup() {
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'lanqiao-editor-'));
  const source = path.join(directory, 'main.cpp');
  await writeFile(source, 'int main() {}');
  const markdown = path.join(directory, '我的题面.md');
  await writeFile(markdown, '# 原始题面');
  let records: LocalProblem[] = [];
  const store = {read: async () => records, write: async (value: LocalProblem[]) => {records = value;}, withLock: <T>(action: () => Promise<T>) => action()};
  const index = new LocalProblemIndex(store);
  const p = {version: 1 as const, id: '3008', title: '测试', url: 'https://www.lanqiao.cn/problems/3008/learning/', markdown: '', tests: []};
  const local = await index.upsert(p, source);
  const other = await index.upsert({...p, id: '30', url: 'https://www.lanqiao.cn/problems/30/learning/'}, source);
  const actions: unknown[][] = [];
  const pickEvents: ((picker: any, events: Record<string, () => void>) => void)[] = [];
  let preview = true;
  let relink: {file: string; notify: () => void} | undefined;
  const vscode = {
    ViewColumn: {One: 1}, ThemeIcon: class {constructor(readonly id: string) {}}, Uri: {file: (fsPath: string) => ({fsPath, scheme: 'file'})},
    workspace: {openTextDocument: async (file: string) => ({uri: {fsPath: file, scheme: 'file'}}), getConfiguration: () => ({get: () => preview})},
    window: {
      tabGroups: {all: []},
      showTextDocument: async (doc: any, options: unknown) => {actions.push(['source', doc.uri.fsPath, options]);},
      showWarningMessage: async (message: string) => {actions.push(['warning', message]);},
      showErrorMessage: async (message: string, action: string) => {actions.push(['error', message]);return relink ? action : undefined;},
      showOpenDialog: async () => relink ? [{fsPath: relink.file, scheme: 'file'}] : [],
      showInformationMessage: async () => {relink?.notify();},
      showInputBox: async () => '贪心， DFS',
      createQuickPick() {
        const events: Record<string, () => void> = {};
        return {items: [], selectedItems: [], onDidAccept: (fn: () => void) => {events.accept = fn;},
          onDidHide: (fn: () => void) => {events.hide = fn;}, onDidTriggerButton: (fn: () => void) => {events.add = fn;},
          dispose() {}, show() {pickEvents.shift()!(this, events);}};
      },
    },
  };
  const mod = {exports: {} as typeof import('../src/local-problem-editor')};
  vm.runInThisContext(`(function(require,module){${(await bundle).outputFiles[0].text}\n})`)((id: string) => id === 'vscode' ? vscode : require(id), mod);
  return {index, local, other, store, source, markdown, actions, pickEvents, ui: mod.exports, problem: p,
    showStatement: async (file: string, linked?: string) => {
      actions.push(['interactive', file, linked]);
      return linked ? stat(linked).then(info => info.isFile(), () => false) : false;
    },
    relink: (file: string) => new Promise<void>(notify => {relink = {file, notify};}),
    setPreview: (value: boolean) => {preview = value;}, cleanup: () => rm(directory, {recursive: true, force: true})};
}

test('题目标签可多选、回显和新建，新标签可跨题复用且取消保留标签', async t => {
  const h = await setup(); t.after(h.cleanup);
  await h.index.setTags(h.other.key, ['DFS', '回溯', 'dfs']);
  h.pickEvents.push((picker, events) => {
    assert.deepEqual(picker.items.map((item: any) => item.label).sort(), ['DFS', '回溯']);
    assert.deepEqual(picker.selectedItems, []);
    picker.selectedItems = picker.items; events.add();
  }, (picker, events) => {
    assert.deepEqual(picker.selectedItems.map((item: any) => item.label).sort(), ['DFS', '回溯', '贪心']);
    events.accept();
  });
  await h.ui.editLocalProblemTags(h.index, h.local);
  const restored = new LocalProblemIndex(h.store);
  await restored.reload();
  assert.deepEqual(restored.get(h.local.key)?.tags.slice().sort(), ['DFS', '回溯', '贪心']);
  h.pickEvents.push((picker, events) => {
    assert.ok(picker.items.some((item: any) => item.label === '贪心'));
    assert.deepEqual(picker.selectedItems.map((item: any) => item.label).sort(), ['DFS', '回溯']);
    picker.selectedItems = []; events.hide();
  });
  await h.ui.editLocalProblemTags(h.index, restored.get(h.other.key)!);
  assert.deepEqual(h.index.get(h.other.key)?.tags, ['DFS', '回溯']);
});

test('源码改名后可重新关联，同一来源和原有标签保持关联', async t => {
  const h = await setup(); t.after(h.cleanup);
  const changed = path.join(path.dirname(h.source), 'new-solution.cpp');
  await writeFile(changed, '// my renamed code');
  await writeFile(path.join(path.dirname(h.source), '.lanqiao.json'), JSON.stringify(h.problem));
  await h.index.setTags(h.local.key, ['DFS']);
  await rm(h.source);
  h.setPreview(false);
  const done = h.relink(changed);
  await h.ui.openLocalProblem(h.index, h.local, h.showStatement);
  await done;
  assert.equal(h.index.get(h.local.key)?.localFilePath, changed);
  assert.deepEqual(h.index.get(h.local.key)?.tags, ['DFS']);
  await h.ui.openLocalProblem(h.index, h.index.get(h.local.key)!, h.showStatement);
  assert.equal(h.actions.at(-1)?.[1], changed);
});

test('本地题目打开已有交互面板，传递关联题面且保留源码焦点', async t => {
  const h = await setup(); t.after(h.cleanup);
  await h.index.setMarkdownPath(h.local.key, h.markdown);
  const problem = h.index.get(h.local.key)!;
  await h.ui.openLocalProblem(h.index, problem, h.showStatement);
  assert.deepEqual(h.actions.map(call => call[0]), ['source', 'interactive']);
  assert.deepEqual(h.actions[1], ['interactive', h.source, h.markdown]);
  h.actions.length = 0;
  await rm(h.markdown);
  await h.ui.openLocalProblem(h.index, problem, h.showStatement);
  assert.deepEqual(h.actions.map(call => call[0]), ['source', 'interactive', 'warning']);
  h.actions.length = 0;
  h.setPreview(false);
  await h.ui.openLocalProblem(h.index, problem, h.showStatement);
  assert.deepEqual(h.actions.map(call => call[0]), ['source']);
});
