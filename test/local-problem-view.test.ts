import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {LocalProblemIndex} from '../src/local-problems';
import {importProblem} from '../src/storage';

async function setup(withSubmissions = false, extended = false) {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'lanqiao-local-problem-view-'));
  const source = path.join(directory, 'main.c');
  await writeFile(source, 'int main(void) { return 0; }\n');
  const markdown = path.join(directory, 'README.md');
  await writeFile(markdown, '# 已有题面\n');
  const problem = {
    key: 'lanqiao-oj:3008', id: '3008', title: '三角形', source: 'lanqiao-oj',
    sourceUrl: 'https://www.lanqiao.cn/problems/3008/learning/', localFilePath: source, markdownFilePath: markdown,
    tags: ['几何', '枚举'], importedAt: 1, updatedAt: 3, status: 'wrong_answer',
    lastSubmittedAt: 3, lastAcceptedAt: 2
  };
  const second = {...problem, key: 'lanqiao-oj:3010', id: '3010', sourceUrl: 'https://www.lanqiao.cn/problems/3010/learning/',
    status: 'not_submitted', tags: [], lastAcceptedAt: undefined, lastSubmittedAt: undefined};
  const course = {...problem, source: 'lanqiao-course', key: 'lanqiao-course:3008',
    sourceUrl: 'https://www.lanqiao.cn/courses/1/learning/?id=2'};
  const extra = [3011, 3012, 3013, 3014].map(id => ({...second, key: `lanqiao-oj:${id}`, id: String(id),
    sourceUrl: `https://www.lanqiao.cn/problems/${id}/learning/`}));
  let stored: unknown = [second, problem, ...(extended ? [course, ...extra] : [])];
  const index = new LocalProblemIndex({read: async () => stored, async write(value) { stored = value; }, withLock: action => action()});
  await index.reload();
  const commands = new Map<string, (target?: unknown) => Promise<void>>();
  const disposable = {dispose() {}};
  const view = {...disposable, description: '', message: ''};
  let provider!: {getChildren(node?: unknown): any[]};
  let select: string | undefined;
  let pickOptions: {matchOnDescription?: boolean; matchOnDetail?: boolean} | undefined;
  let offered: Array<{label: string; detail?: string}> = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const errors: string[] = [];
  const previews: Array<[string, string | undefined]> = [];
  const workspaceState = new Map<string, unknown>();
  let notifyConfiguration: (event: {affectsConfiguration: (key: string) => boolean}) => void = () => {};
  let limit: number | undefined, preview = false, confirm = false;
  let firstTagPicker = true;
  const vscode = {
    EventEmitter: class {
      event = () => disposable;
      fire() {}
      dispose() {}
    },
    TreeItem: class { constructor(readonly label: string, readonly collapsibleState: number) {} },
    ThemeIcon: class { constructor(readonly id: string) {} },
    TreeItemCollapsibleState: {None: 0, Collapsed: 1, Expanded: 2},
    commands: {registerCommand(id: string, run: (target?: unknown) => Promise<void>) { commands.set(id, run); return disposable; }},
    workspace: {
      async openTextDocument(file: string) { return {file}; },
      getConfiguration: () => ({get: (key: string, fallback: unknown) => key === 'openMarkdownBesideSource' ? preview : limit ?? fallback}),
      onDidChangeConfiguration(fn: typeof notifyConfiguration) { notifyConfiguration = fn; return disposable; },
    },
    ViewColumn: {One: 1},
    Uri: {parse(url: string) { return {url}; }},
    env: {
      async openExternal(uri: {url: string}) { opened.push(uri.url); },
      clipboard: {async writeText(value: string) { copied.push(value); }}
    },
    window: {
      tabGroups: {all: []},
      createTreeView(id: string, options: {treeDataProvider: typeof provider}) {
        assert.equal(id, 'lanqiao.localProblems');
        provider = options.treeDataProvider;
        return view;
      },
      async showQuickPick(items: typeof offered, options: typeof pickOptions) {
        offered = items;
        pickOptions = options;
        return select === undefined ? undefined : items.find(item => item.label.includes(select!));
      },
      async showInputBox() { return '递推，状态压缩, 递推, '; },
      createQuickPick() {
        let accept!: () => void, add!: () => void;
        return {selectedItems: [] as unknown[], onDidAccept: (fn: () => void) => {accept = fn;},
          onDidTriggerButton: (fn: () => void) => {add = fn;}, onDidHide() {}, dispose() {}, show() {
            if (firstTagPicker) { firstTagPicker = false; this.selectedItems = []; add(); }
            else accept();
          }};
      },
      async showTextDocument(document: {file: string}) { opened.push(document.file); },
      async showWarningMessage(_message: string, options: {modal: boolean}, action: string) {
        assert.ok(options.modal);
        return confirm ? action : undefined;
      },
      async showErrorMessage(message: string) { errors.push(message); }
    }
  };
  const result = await build({
    entryPoints: ['src/local-problem-view.ts'], bundle: true, format: 'cjs',
    platform: 'node', write: false, external: ['vscode']
  });
  const createModule = vm.runInThisContext(`(function(require, module){${result.outputFiles[0].text}\n})`);
  const module = {exports: {} as typeof import('../src/local-problem-view')};
  createModule((id: string) => id === 'vscode' ? vscode : require(id), module);
  const snapshots = [{id: 's1', problemKey: problem.key, createdAt: 3, language: 'c', sourcePath: source,
    status: 'wrong_answer', officialStatus: 'WA', codeHash: 'abc'}];
  const reviews = [{problemKey: problem.key, status: 'reviewing', lastFailure: {at: 3, status: 'wrong_answer', id: 's1'}}];
  let notifySubmissions = () => {};
  const submissions = {
    list: (key: string) => snapshots.filter(snapshot => snapshot.problemKey === key),
    listReviews: () => reviews.slice(),
    onChange(listener: () => void) { notifySubmissions = listener; return () => {}; }
  };
  const context = {subscriptions: [] as Array<{dispose(): void}>, workspaceState: {
    get: (key: string) => workspaceState.get(key),
    async update(key: string, value: unknown) { workspaceState.set(key, value); },
  }};
  const register = () => module.exports.registerLocalProblemView(context as any, index, async () => ({found: 0, added: 0, skipped: 0}),
    async (file, statement) => { previews.push([file, statement]); return true; },
    undefined, withSubmissions ? submissions as any : undefined);
  register();

  const children = (label?: string) => provider.getChildren(label ? provider.getChildren().find(node => node.label === label) : undefined);
  const run = (command: string, target?: unknown) => commands.get(`lanqiao.${command}`)!(target);
  return {source, markdown, problem, course, view, provider, children, run, opened, copied, errors, index, reviews, snapshots, previews, workspaceState,
    configureLimit: (value: number) => {
      limit = value;
      notifyConfiguration({affectsConfiguration: key => key === 'lanqiao.recentProblems.limit'});
    },
    enablePreview: () => { preview = true; },
    confirm: () => { confirm = true; },
    reactivate: () => { context.subscriptions.splice(0).forEach(item => item.dispose()); register(); },
    refreshSubmissions: () => notifySubmissions(),
    searchState: () => ({offered, pickOptions}), select: (label: string) => { select = label; },
    cleanup: () => rm(directory, {recursive: true, force: true})};
}

test('题号命名和旧 main.cpp 在所有视图保留真实标题、悬停文本和状态图标', async t => {
  const h = await setup(true);
  t.after(h.cleanup);
  const root = path.join(path.dirname(h.source), 'imports');
  const metadata = (id: string, title: string) => ({version: 1 as const, id, title,
    url: `https://www.lanqiao.cn/problems/${id}/learning/`, markdown: '# 题面', tests: []});
  const numbered = metadata('3263', '【练习】选题');
  const legacy = metadata('17003', '【练习】霓虹' + ' 完整原标题'.repeat(15));
  const fresh = await importProblem(root, h.source, numbered);
  const old = await importProblem(root, h.source, legacy, '', 'cpp', undefined, {naming: 'main'});
  assert.equal(path.basename(fresh.source), '3263.cpp');
  assert.equal(path.basename(old.source), 'main.cpp');
  const a = await h.index.upsert(numbered, fresh.source);
  const b = await h.index.upsert(legacy, old.source);
  await h.index.setTags(a.key, ['动态规划']);
  await h.index.recordResult({kind: 'submit', problemId: a.id, state: 'finished', created: 5,
    result: {phase: 'done', submissionId: 'fixture-3263', status: 'AC'}});
  h.reviews.push({problemKey: a.key, status: 'reviewing', lastFailure: {at: 3, status: 'wrong_answer', id: 's2'}});
  h.snapshots.push({...h.snapshots[0], problemKey: a.key, id: 's2', sourcePath: fresh.source, language: 'cpp'});

  await h.run('openLocalSource', a.key);
  await h.run('openLocalSource', b.key);
  const repeated = await importProblem(root, h.source, numbered);
  assert.equal(repeated.source, fresh.source);
  await h.index.upsert(numbered, repeated.source);
  await h.index.reload();
  h.reactivate();

  const list = (node?: unknown): any[] => h.provider.getChildren(node).flatMap(item => [item, ...list(item)]);
  const nodes = list();
  const problemNodes = (key: string) => nodes.filter(node => node.problemKey === key && node.command?.command === 'lanqiao.openLocalSource');
  const numberedRows = problemNodes(a.key);
  assert.equal(numberedRows.length, 5); // 最近打开、全部题目、按标签、按状态、错题复盘
  for (const row of numberedRows) {
    assert.equal(row.label, '#3263 【练习】选题');
    assert.match(row.tooltip, /^#3263 【练习】选题/);
    assert.equal(row.iconPath.id, 'pass');
  }
  for (const row of problemNodes(b.key)) {
    assert.equal(row.label, `#17003 ${legacy.title}`);
    assert.ok(row.tooltip.startsWith(row.label));
    assert.equal(row.iconPath.id, 'circle-outline');
  }
  const history = nodes.find(node => node.problemKey === a.key && node.contextValue === 'lanqiaoSubmissionHistory');
  assert.equal(h.provider.getChildren(history)[0].snapshotId, 's2');
  const recent = h.children('最近打开').find(node => node.problemKey === a.key);
  await h.run('openLocalSource', recent.command.arguments[0]);
  assert.equal(h.opened.at(-1), fresh.source);
});

test('最近打开默认五题，可立即调整数量，区分来源并复用工作区记录及已有题面', async t => {
  const h = await setup(true, true);
  t.after(h.cleanup);
  const keys = [h.problem.key, h.course.key, 'lanqiao-oj:3010', 'lanqiao-oj:3011', 'lanqiao-oj:3012', 'lanqiao-oj:3013'];
  const recent = () => h.children('最近打开').map(item => item.problemKey);
  assert.equal(h.children().some(node => node.label === '最近打开'), false);
  for (const key of keys) await h.run('openLocalSource', key);
  assert.deepEqual(recent(), keys.slice(1).reverse());
  assert.deepEqual(h.previews, []);
  h.configureLimit(6);
  assert.deepEqual(recent(), keys.slice().reverse());
  h.reactivate();
  assert.deepEqual(recent(), keys.slice().reverse());
  h.enablePreview();
  const old = h.children('最近打开').at(-1);
  await h.run('openLocalSource', old.command.arguments[0]);
  assert.equal(old.contextValue, 'lanqiaoRecentProblem');
  assert.equal(h.opened.at(-1), h.source);
  assert.deepEqual(h.previews, [[h.source, h.markdown]]);
  assert.deepEqual(recent(), [keys[0], ...keys.slice(1).reverse()]);
  h.refreshSubmissions();
  assert.deepEqual(recent(), [keys[0], ...keys.slice(1).reverse()]);
  await h.run('openLocalOriginal', old);
  assert.equal(h.opened.at(-1), h.problem.sourceUrl);
  await h.run('removeRecentProblem', old);
  assert.deepEqual(recent(), keys.slice(1).reverse());
  await h.run('clearRecentProblems');
  assert.equal(recent().length, 5);
  h.confirm();
  await h.run('clearRecentProblems');
  assert.equal(h.children().some(node => node.label === '最近打开'), false);
  assert.equal(h.provider.getChildren(h.children('全部题目').find(row => row.problemKey === h.problem.key))[0].label, '提交历史');
  assert.equal(h.children('错题复盘').length, 1);
  assert.deepEqual(h.index.get(h.problem.key)?.tags, ['几何', '枚举']);
  assert.equal(await readFile(h.source, 'utf8'), 'int main(void) { return 0; }\n');
  assert.equal(await readFile(h.markdown, 'utf8'), '# 已有题面\n');
});

test('打开失败不会更新最近时间，损坏条目及找不到题目的记录不占显示数量', async t => {
  const h = await setup();
  t.after(h.cleanup);
  await h.run('openLocalSource', h.problem.key);
  const [storageKey] = h.workspaceState.keys();
  const stored = h.workspaceState.get(storageKey) as unknown[];
  h.workspaceState.set(storageKey, [...stored, null, {problemKey: 'lanqiao-oj:9999', lastOpenedAt: Date.now() + 100},
    {problemKey: 'lanqiao-oj:3010', lastOpenedAt: 'bad'}]);
  h.configureLimit(1);
  assert.deepEqual(h.children('最近打开').map(item => item.problemKey), [h.problem.key]);
  const before = JSON.stringify([...h.workspaceState.entries()]);
  await rm(h.source);
  await h.run('openLocalSource', h.problem.key);
  assert.match(h.errors.at(-1) ?? '', /找不到题目.*源码/);
  assert.equal(JSON.stringify([...h.workspaceState.entries()]), before);
});

test('本地题库按最近结果筛选且保留曾通过标记，多标签中的题目节点各有独立标识', async t => {
  const h = await setup();
  t.after(h.cleanup);
  const [first, last] = h.children('全部题目');
  assert.match(first.label, /3008.*三角形/);
  assert.match(first.description, /答案错误.*曾通过/);
  assert.match(last.label, /3010/);
  assert.equal(first.contextValue, 'lanqiaoLocalProblem');
  assert.equal(first.command.command, 'lanqiao.openLocalSource');
  const tagNodes = h.children('按标签').filter(node => ['几何', '枚举'].includes(node.label));
  assert.equal(tagNodes.length, 2);
  assert.notEqual(h.provider.getChildren(tagNodes[0])[0].id, h.provider.getChildren(tagNodes[1])[0].id);
  const wrongAnswer = h.children('按状态').find(node => node.label.includes('答案错误'));
  assert.match(h.provider.getChildren(wrongAnswer)[0].label, /3008/);

  h.select('答案错误');
  await h.run('filterLocalProblems');
  assert.match(h.view.description, /1\s*\/\s*2/);
  assert.equal(h.children('筛选结果').length, 1);
  h.select('通过（AC）');
  await h.run('filterLocalProblems');
  assert.equal(h.children().length, 0);
  assert.match(h.view.message, /没有题目/);
});

test('提交历史挂在对应题目下，错题复盘分组独立于最近评测筛选', async t => {
  const h = await setup(true);
  t.after(h.cleanup);
  const [problem] = h.children('全部题目');
  const [history] = h.provider.getChildren(problem);
  const [snapshot] = h.provider.getChildren(history);
  assert.equal(problem.command.command, 'lanqiao.openLocalSource');
  assert.equal(history.contextValue, 'lanqiaoSubmissionHistory');
  assert.equal(snapshot.contextValue, 'lanqiaoSubmissionSnapshot');
  assert.deepEqual(snapshot.command.arguments, [{problemKey: h.problem.key, snapshotId: 's1'}]);
  assert.match(snapshot.description, /答案错误.*WA/);

  h.select('通过（AC）');
  await h.run('filterLocalProblems');
  const reviewing = h.children('错题复盘').find(node => node.label === '复盘中');
  assert.equal(h.provider.getChildren(reviewing)[0].contextValue, 'lanqiaoReviewProblem');
  h.reviews[0].status = 'reviewed';
  h.refreshSubmissions();
  const reviewed = h.children('错题复盘').find(node => node.label === '已复盘');
  assert.match(h.provider.getChildren(reviewed)[0].description, /答案错误.*已复盘/);
});

test('本地题库搜索打开已登记的源码，标签和原题操作使用同一题目记录', async t => {
  const h = await setup();
  t.after(h.cleanup);
  h.select('3008');
  await h.run('searchLocalProblems');
  const {offered, pickOptions} = h.searchState();
  const searchItem = offered.find(item => item.label.includes('3008'));
  assert.match(searchItem?.label ?? '', /三角形/);
  assert.match(searchItem?.detail ?? '', /几何.*枚举/);
  assert.equal(pickOptions?.matchOnDetail, true);
  assert.deepEqual(h.opened, [h.source]);

  const [row] = h.children('全部题目');
  await h.run('editLocalProblemTags', row);
  assert.deepEqual(h.index.get(h.problem.key)?.tags, ['递推', '状态压缩']);
  assert.ok(h.children('按标签').some(node => node.label === '状态压缩'));
  await h.run('copyLocalProblemId', row);
  assert.deepEqual(h.copied, ['3008']);
  await h.run('openLocalOriginal', row);
  assert.deepEqual(h.opened, [h.source, h.problem.sourceUrl]);
  await rm(h.source);
  await h.run('openLocalSource', row.command.arguments[0]);
  assert.equal(h.opened.length, 2);
  assert.match(h.errors[0], /恢复该文件或重新导入题目/);
});
