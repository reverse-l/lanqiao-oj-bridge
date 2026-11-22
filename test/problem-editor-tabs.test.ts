import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle = build({entryPoints: ['src/problem-editor-tabs.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', external: ['vscode'], logLevel: 'silent'});

async function setup() {
  const groups = [1, 2, 3].map(viewColumn => ({viewColumn, tabs: [] as TestTab[]}));
  const closed: TestTab[] = [];
  class TabInputText {constructor(readonly uri: {scheme: string; toString(): string}) {}}
  type TestTab = {group: typeof groups[number]; input: unknown; isDirty: boolean; isPinned: boolean};
  let mode = 'smart';
  let focused = '';
  const add = (input: unknown, column: number) => {
    const group = groups[column - 1];
    const tab = {group, input, isDirty: false, isPinned: false};
    group.tabs.push(tab);
    return tab;
  };
  const document = (id: string) => ({uri: {scheme: 'file', toString: () => `file:///${id}/main.cpp`}, isDirty: false});
  const docs = [document('one'), document('two'), document('three')];
  const statementFor = new Map<string, TestTab>();
  const vscode = {
    TabInputText,
    window: {
      tabGroups: {all: groups, async close(tab: TestTab, preserveFocus: boolean) {
        assert.equal(preserveFocus, true);
        closed.push(tab);
        tab.group.tabs.splice(tab.group.tabs.indexOf(tab), 1);
        return true;
      }},
      async showTextDocument(doc: typeof docs[number], view: {viewColumn: number}) {
        focused = doc.uri.toString();
        const group = groups[view.viewColumn - 1];
        if (!group.tabs.some(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === focused)) {
          add(new TabInputText(doc.uri), view.viewColumn);
        }
        return {viewColumn: view.viewColumn};
      },
    },
    workspace: {getConfiguration: () => ({get: () => mode})},
  };
  const mod = {exports: {} as typeof import('../src/problem-editor-tabs')};
  vm.runInThisContext(`(function(require,module){${(await bundle).outputFiles[0].text}\n})`)((id: string) => id === 'vscode' ? vscode : require(id), mod);
  const controller = new mod.exports.ProblemEditorTabs();
  const open = (id: number, column = 1, statementColumn = 2, closeStatement = () => true) => controller.open(String(id),
    docs[id - 1] as any, {
      sourceOptions: {viewColumn: column, preview: false},
      showStatement: statementColumn ? async track => {
        const key = String(id);
        let tab = statementFor.get(key);
        if (!tab || !tab.group.tabs.includes(tab)) {
          tab = add({viewType: 'lanqiao.problem'}, statementColumn);
          statementFor.set(key, tab);
        }
        track(tab as any, closeStatement);
        return true;
      } : undefined,
    });
  return {docs, groups, add, TabInputText, closed, open, focused: () => focused, setMode: (value: string) => {mode = value;}};
}

test('smart 在同组替换由扩展打开的上一题，预览与源码两组复用', async () => {
  const h = await setup();
  const unrelated = h.add({viewType: 'markdown.preview'}, 2);
  const review = h.add(new h.TabInputText({scheme: 'file', toString: () => 'file:///review.md'}), 1);
  const diff = h.add({original: 'lanqiao-submission:/history', modified: 'file:///main.cpp'}, 1);
  await h.open(1);
  const firstSource = h.groups[0].tabs.at(-1);
  const firstStatement = h.groups[1].tabs.at(-1);
  await h.open(1);
  assert.equal(h.closed.length, 0);
  await h.open(2);
  assert.deepEqual(h.closed, [firstSource, firstStatement]);
  assert.ok(h.groups[1].tabs.includes(unrelated));
  assert.ok(h.groups[0].tabs.includes(review));
  assert.ok(h.groups[0].tabs.includes(diff));
  assert.equal(h.focused(), h.docs[1].uri.toString());
});

test('未保存、固定、手动打开与题面仍有修改的标签受到保护', async () => {
  const h = await setup();
  await h.open(1);
  h.docs[0].isDirty = true;
  h.groups[1].tabs[0].isPinned = true;
  const manual = h.add(new h.TabInputText(h.docs[1].uri), 1);
  await h.open(2, 1, 2, () => false);
  await h.open(3);
  assert.equal(h.closed.length, 0);
  assert.ok(h.groups[0].tabs.includes(manual));
});

test('keep 保留所有，closePrevious 在对应预览未开启时清理上一题，并识别手动重新打开的标签', async () => {
  const h = await setup();
  await h.open(1);
  h.setMode('keep');
  await h.open(2);
  assert.equal(h.closed.length, 0);
  h.setMode('closePrevious');
  const source = h.groups[0].tabs.pop();
  const oldStatement = h.groups[1].tabs.at(-1);
  const reopened = h.add(new h.TabInputText(h.docs[1].uri), 1);
  await h.open(3, 3, 0);
  assert.deepEqual(h.closed, [oldStatement]);
  assert.ok(h.groups[0].tabs.includes(reopened));
  assert.ok(!h.closed.includes(source!));
});

test('smart 仅在同组有替代标签时清理，预览关闭后仍可显式清理已登记的上一题', async () => {
  const h = await setup();
  await h.open(1);
  const firstSource = h.groups[0].tabs[0];
  const firstStatement = h.groups[1].tabs[0];
  await h.open(2, 3, 0);
  assert.equal(h.closed.length, 0);
  await h.open(1);
  await h.open(1, 1, 0);
  h.setMode('closePrevious');
  await h.open(3, 3, 0);
  assert.deepEqual(h.closed, [firstSource, firstStatement]);
});
