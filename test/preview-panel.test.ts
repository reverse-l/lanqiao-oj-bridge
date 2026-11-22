import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';

test('交互题面在并发打开、重新关联与恢复时复用，每份源码最多一个面板', async t => {
 const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'lanqiao-panel-'));
 t.after(() => rm(root, {recursive: true, force: true}));
 const source = path.join(root, 'main.cpp');
 const canonical = path.join(root, 'README.md');
 const linked = path.join(root, 'linked.md');
 const metadata = {version: 1, id: '182', title: '示例', url: 'https://www.lanqiao.cn/problems/182/learning/', markdown: '', tests: []};
 await writeFile(source, 'int main() {}\n');
 await writeFile(canonical, '原始题面\n');
 await writeFile(linked, '重新关联的题面\n');
 await writeFile(path.join(root, '.lanqiao.json'), JSON.stringify(metadata));

 const disposable = {dispose() {}};
 const clipboard: string[] = [];
 const warnings: string[] = [];
 const reveals: unknown[][] = [];
 const panels: Array<ReturnType<typeof newPanel>> = [];
 let restore!: (panel: ReturnType<typeof newPanel>, state: unknown) => Promise<void>;
 let statement: string | undefined;
 function newPanel() {
  let closed: (() => void) | undefined;
  let receive: (message: unknown) => Promise<void> = async () => {};
  let html = '', renders = 0;
  return {
   disposed: false, active: false, get renders() {return renders;},
   dispose() {this.disposed = true; closed?.();},
   reveal(...args: unknown[]) {reveals.push(args);},
   onDidDispose(fn: () => void) {closed = fn; return disposable;},
   dispatch(message: unknown) {return receive(message);},
   webview: {
    get html() {return html;}, set html(value: string) {html = value; renders++;},
    asWebviewUri: (uri: string) => uri, cspSource: 'vscode-resource:',
    postMessage: async () => true,
    onDidReceiveMessage(fn: typeof receive) {receive = fn; return disposable;},
   },
  };
 }
 const api = {
  ViewColumn: {Two: 2}, Uri: {file: (fsPath: string) => ({fsPath}), joinPath: (...parts: string[]) => parts.join('/')},
  RelativePattern: class {},
  window: {
   registerWebviewPanelSerializer(_view: string, serializer: {deserializeWebviewPanel: typeof restore}) {restore = serializer.deserializeWebviewPanel; return disposable;},
   createWebviewPanel(_type: string, _title: string, options: unknown) {
    assert.deepEqual(options, {viewColumn: 2, preserveFocus: true});
    const panel = newPanel(); panels.push(panel); return panel;
   },
   async showWarningMessage(message: string) {warnings.push(message);},
  },
  workspace: {createFileSystemWatcher: () => ({...disposable, onDidChange: () => disposable, onDidCreate: () => disposable})},
  env: {clipboard: {writeText: async (value: string) => {clipboard.push(value);}}},
 };
 const bundle = await build({entryPoints: ['src/preview-panel.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode']});
 const mod = {exports: {} as typeof import('../src/preview-panel')};
 vm.runInThisContext(`(function(require,module){${bundle.outputFiles[0].text}\n})`)((id: string) => id === 'vscode' ? api : require(id), mod);
 let savedSources: string[] = [];
 const manager = new mod.exports.ProblemPreviews({extensionUri: 'extension', workspaceState: {
  get: () => savedSources, update: async (_key: string, sources: string[]) => {savedSources = sources;},
 }} as any, async () => 'ok', () => ({kind: 'waiting', label: '等待网页连接', detail: '', canRunOnline: false}), () => statement);
 t.after(() => manager.dispose());

 assert.deepEqual(await Promise.all([manager.show(source), manager.show(source, canonical), manager.show(source)]), [true, true, true]);
 const [panel] = panels;
 assert.equal(panels.length, 1);
 assert.equal(panel.renders, 1);
 assert.match(panel.webview.html, /发送至 CPH/);
 assert.deepEqual(reveals, [[2, true], [2, true]]);
 const duplicate = newPanel();
 await restore(duplicate, {version: 1, source, scrollY: 10});
 assert.equal(duplicate.disposed, true);
 assert.equal(panel.disposed, false);
 await panel.dispatch({type: 'viewState', scrollY: 240});
 statement = linked;
 assert.equal(await manager.show(source, linked), true);
 assert.equal(panels.length, 1);
 assert.equal(panel.renders, 2);
 assert.match(panel.webview.html, /重新关联的题面/);
 await panel.dispatch({action: 'copyMarkdown'});
 assert.deepEqual(clipboard, ['重新关联的题面\n']);
 assert.equal(await manager.show(source, linked), true);
 assert.equal(panel.renders, 2);
 assert.equal(await readFile(canonical, 'utf8'), '原始题面\n');
 assert.equal(await readFile(source, 'utf8'), 'int main() {}\n');
 panel.dispose();
 const restored = newPanel();
 await restore(restored, {version: 1, source, scrollY: 240});
 assert.match(restored.webview.html, /重新关联的题面/);
 assert.equal(await manager.show(source), true);
 assert.equal(restored.renders, 1);
 assert.deepEqual(warnings, []);
});
