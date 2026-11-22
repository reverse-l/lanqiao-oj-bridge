import * as vscode from 'vscode';
import {normalizeTags, type LocalProblem, type LocalProblemIndex, type MigrationResult, type ProblemStatus} from './local-problems';
import {OFFICIAL_ORIGINS} from './problem';
import {editLocalProblemTags, openLocalProblem, type ShowProblemStatement} from './local-problem-editor';
import {defaultRecentProblemLimit, maxRecentProblems, RecentProblems} from './recent-problems';
import {ProblemEditorTabs} from './problem-editor-tabs';
import type {ReviewEntry, ReviewStatus, SubmissionSnapshot, SubmissionStore} from './submission-store';
import {reviewStatusLabels, reviewStatuses, submissionDetails, submissionStatus, submissionTime} from './submission-view';

const statusLabels: Record<ProblemStatus, string> = {
  not_submitted: '未提交',
  accepted: '通过（AC）',
  wrong_answer: '答案错误（WA）',
  time_limit_exceeded: '超时（TLE）',
  memory_limit_exceeded: '内存超限（MLE）',
  runtime_error: '运行错误（RE）',
  compile_error: '编译错误（CE）',
  other: '其他结果'
};
const statuses = Object.keys(statusLabels) as ProblemStatus[];
const commands = {
  search: 'lanqiao.searchLocalProblems',
  filter: 'lanqiao.filterLocalProblems',
  migrate: 'lanqiao.importExistingProblems',
  openSource: 'lanqiao.openLocalSource',
  openOriginal: 'lanqiao.openLocalOriginal',
  copyId: 'lanqiao.copyLocalProblemId',
  editTags: 'lanqiao.editLocalProblemTags',
  removeRecent: 'lanqiao.removeRecentProblem',
  clearRecent: 'lanqiao.clearRecentProblems'
};

type ProblemNode = vscode.TreeItem & {children?: () => ProblemNode[]; problemKey?: string; snapshotId?: string};

function problemTitle(problem: LocalProblem): string {
  return `#${problem.id} ${problem.title}`;
}

function problemStatus(problem: LocalProblem): string {
  const label = problem.status === 'other' && problem.officialStatus
    ? `${statusLabels.other}（${problem.officialStatus}）` : statusLabels[problem.status];
  const wasAccepted = problem.lastAcceptedAt !== undefined && problem.status !== 'accepted';
  return wasAccepted ? `${label} · 曾通过` : label;
}

function statusIcon(status: ProblemStatus): string {
  if (status === 'not_submitted') return 'circle-outline';
  return status === 'accepted' ? 'pass' : 'error';
}

function snapshotItem(snapshot: SubmissionSnapshot, parent: string): ProblemNode {
  const item: ProblemNode = new vscode.TreeItem(submissionTime(snapshot.createdAt), vscode.TreeItemCollapsibleState.None);
  const {problemKey, id: snapshotId} = snapshot;
  item.id = JSON.stringify([parent, snapshotId]);
  item.contextValue = 'lanqiaoSubmissionSnapshot';
  item.problemKey = problemKey;
  item.snapshotId = snapshotId;
  item.description = submissionDetails(snapshot);
  const officialId = snapshot.submissionId ? `\n官方提交 #${snapshot.submissionId}` : '';
  item.tooltip = `${item.label}\n${item.description}${officialId}`;
  item.iconPath = new vscode.ThemeIcon('file-code');
  item.command = {command: 'lanqiao.openSubmission', title: '查看快照', arguments: [{problemKey, snapshotId}]};
  return item;
}

function problemItem(problem: LocalProblem, parent: string, store?: SubmissionStore, review?: ReviewEntry): ProblemNode {
  const snapshots = store?.list(problem.key) ?? [];
  const state = snapshots.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
  const item: ProblemNode = new vscode.TreeItem(problemTitle(problem), state);
  item.id = JSON.stringify([parent, problem.key]);
  item.contextValue = review ? 'lanqiaoReviewProblem' : 'lanqiaoLocalProblem';
  item.problemKey = problem.key;
  item.command = {command: commands.openSource, title: '打开源码', arguments: [problem.key]};
  item.iconPath = new vscode.ThemeIcon(statusIcon(problem.status));
  item.description = [problemStatus(problem), review ? reviewStatusLabels[review.status] : '',
    problem.source === 'lanqiao-course' ? '课程' : '', ...problem.tags].filter(Boolean).join(' · ');
  const failure = review?.lastFailure;
  const lastFailure = failure ? `上次失败 · ${submissionStatus(failure.status)} · ${submissionTime(failure.at)}` : '';
  const reviewedAt = review?.status === 'reviewed' && review.reviewedAt !== undefined
    ? `完成复盘 · ${submissionTime(review.reviewedAt)}` : '';
  item.tooltip = [item.label, item.description, problem.localFilePath, lastFailure, reviewedAt].filter(Boolean).join('\n');
  if (snapshots.length) {
    const id = JSON.stringify([item.id, 'history']);
    item.children = () => {
      const history = problemGroup(id, '提交历史', 'history', () => snapshots.map(snapshot => snapshotItem(snapshot, id)));
      history.contextValue = 'lanqiaoSubmissionHistory';
      history.problemKey = problem.key;
      history.description = `${snapshots.length} 次`;
      return [history];
    };
  }
  return item;
}

function problemGroup(id: string, label: string, icon: string, children: () => ProblemNode[], expanded = false): ProblemNode {
  const collapsibleState = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  const item: ProblemNode = new vscode.TreeItem(label, collapsibleState);
  item.id = id;
  item.iconPath = new vscode.ThemeIcon(icon);
  item.children = children;
  return item;
}

function groupProblems<K>(problems: LocalProblem[], keysFor: (problem: LocalProblem) => K[]): Map<K, LocalProblem[]> {
  const groups = new Map<K, LocalProblem[]>();
  for (const problem of problems) {
    for (const key of keysFor(problem)) {
      const group = groups.get(key);
      if (group) group.push(problem);
      else groups.set(key, [problem]);
    }
  }
  return groups;
}

function buildTree(problems: LocalProblem[], filtered: boolean, store?: SubmissionStore): ProblemNode[] {
  if (!problems.length) return [];

  const problemEntries = (id: string, label: string, icon: string, entries: LocalProblem[]) => {
    const group = problemGroup(id, label, icon, () => entries.map(problem => problemItem(problem, id, store)));
    group.description = `${entries.length} 题`;
    return group;
  };
  const tagLabels = new Map(normalizeTags(problems.flatMap(problem => problem.tags)).map(tag => [tag.toLowerCase(), tag]));
  const byTag = groupProblems<string | null>(problems, problem => problem.tags.length
    ? problem.tags.map(tag => tagLabels.get(tag.toLowerCase())!) : [null]);
  const byStatus = groupProblems(problems, problem => [problem.status]);
  return [
    problemGroup('list', filtered ? '筛选结果' : '全部题目', 'list-ordered',
      () => problems.map(problem => problemItem(problem, 'list', store)), true),
    problemGroup('by-tag', '按标签', 'tag', () => [...byTag]
      .sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left.localeCompare(right, 'zh-CN'))
      .map(([tag, entries]) => problemEntries(JSON.stringify(['tag', tag]), tag ?? '未添加标签',
        tag === null ? 'circle-slash' : 'tag', entries))),
    problemGroup('by-status', '按状态', 'checklist', () => statuses.flatMap(status => {
      const entries = byStatus.get(status);
      return entries ? [problemEntries(JSON.stringify(['status', status]), statusLabels[status], statusIcon(status), entries)] : [];
    }))
  ];
}

function reviewGroups(problems: LocalProblem[], store?: SubmissionStore): ProblemNode[] {
  if (!store) return [];
  const indexed = new Map(problems.map(problem => [problem.key, problem]));
  const reviews = store.listReviews().flatMap(review => {
    const problem = indexed.get(review.problemKey);
    return problem ? [{review, problem}] : [];
  });
  if (!reviews.length) return [];
  const icons: Record<ReviewStatus, string> = {needs_review: 'circle-outline', reviewing: 'edit', reviewed: 'pass'};
  const root = problemGroup('review', '错题复盘', 'book', () => reviewStatuses.flatMap(status => {
    const entries = reviews.filter(({review}) => review.status === status);
    if (!entries.length) return [];
    const id = JSON.stringify(['review', status]);
    const item = problemGroup(id, reviewStatusLabels[status], icons[status],
      () => entries.map(({review, problem}) => problemItem(problem, id, store, review)));
    item.description = `${entries.length} 题`;
    return [item];
  }));
  root.contextValue = 'lanqiaoReviewRoot';
  root.description = `${reviews.length} 题`;
  return [root];
}

function problemsById(problems: LocalProblem[]): LocalProblem[] {
  return problems.sort((left, right) => Number(left.id) - Number(right.id) || left.key.localeCompare(right.key));
}

function recentGroup(recent: RecentProblems, index: LocalProblemIndex): ProblemNode[] {
  const value = vscode.workspace.getConfiguration('lanqiao').get('recentProblems.limit', defaultRecentProblemLimit);
  const limit = Number.isInteger(value) ? Math.max(1, Math.min(maxRecentProblems, value)) : defaultRecentProblemLimit;
  const problems: LocalProblem[] = [];
  for (const entry of recent.list()) {
    const problem = index.get(entry.problemKey);
    if (problem) problems.push(problem);
    if (problems.length >= limit) break;
  }
  if (!problems.length) return [];
  const id = 'recent';
  const group = problemGroup(id, '最近打开', 'history', () => problems.map(problem => {
    const item = problemItem(problem, id);
    item.contextValue = 'lanqiaoRecentProblem';
    return item;
  }), true);
  group.description = `${problems.length} 题`;
  return [group];
}

export function registerLocalProblemView(
  context: vscode.ExtensionContext,
  index: LocalProblemIndex,
  migrate: () => Promise<MigrationResult>,
  showStatement: ShowProblemStatement,
  onOpen: (problem: LocalProblem) => void = () => {},
  store?: SubmissionStore,
  tabs = new ProblemEditorTabs(),
): void {
  const recent = new RecentProblems(context.workspaceState);
  let filter: ProblemStatus | undefined;
  let roots: ProblemNode[] = [];
  const changes = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<ProblemNode> = {
    onDidChangeTreeData: changes.event,
    getTreeItem: node => node,
    getChildren: node => node ? node.children?.() ?? [] : roots
  };
  const view = vscode.window.createTreeView('lanqiao.localProblems', {treeDataProvider: provider, showCollapseAll: true});
  const refresh = () => {
    const all = problemsById(index.list());
    const visible = filter ? all.filter(problem => problem.status === filter) : all;
    roots = [...recentGroup(recent, index), ...buildTree(visible, filter !== undefined, store), ...reviewGroups(all, store)];
    view.description = filter ? `${visible.length} / ${all.length} 题 · ${statusLabels[filter]}` : `共 ${all.length} 题`;
    view.message = all.length && !visible.length ? '当前筛选条件下没有题目。' : undefined;
    changes.fire();
  };
  const unsubscribe = index.onChange(refresh);
  context.subscriptions.push(view, changes, {dispose: unsubscribe});
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('lanqiao.recentProblems.limit')) refresh();
  }));
  if (store) context.subscriptions.push({dispose: store.onChange(refresh)});
  refresh();

  const problemFor = (target: unknown): LocalProblem => {
    const key = typeof target === 'object' && target !== null && 'problemKey' in target ? target.problemKey : target;
    const problem = typeof key === 'string' ? index.get(key) : undefined;
    if (!problem) throw new Error('本地题目记录已找不到，请重新选择题目。');
    return problem;
  };
  const register = (command: string, run: (target?: unknown) => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, async (target?: unknown) => {
      try {
        await run(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Lanqiao：${message}`);
      }
    }));
  };

  let opening = Promise.resolve();
  const open = (problem: LocalProblem) => {
    const request = opening.then(() => openLocalProblem(index, index.get(problem.key) ?? problem, showStatement, async opened => {
      onOpen(opened);
      try {
        await recent.recordOpen(opened.key);
        refresh();
      } catch (error) {
        void vscode.window.showErrorMessage(`无法记住最近打开的题目：${error instanceof Error ? error.message : String(error)}`);
      }
    }, tabs));
    opening = request.catch(() => {});
    return request;
  };
  register(commands.openSource, async target => open(problemFor(target)));
  register(commands.removeRecent, async target => {
    await recent.remove(problemFor(target).key);
    refresh();
  });
  register(commands.clearRecent, async () => {
    if (!recent.list().length) return;
    const action = '清空记录';
    const choice = await vscode.window.showWarningMessage('清空当前工作区的最近打开记录？', {modal: true}, action);
    if (choice !== action) return;
    await recent.clear();
    refresh();
  });
  register(commands.openOriginal, async target => {
    const problem = problemFor(target);
    const url = new URL(problem.sourceUrl);
    if (!OFFICIAL_ORIGINS.has(url.origin) || url.username || url.password) throw new Error('题目的蓝桥官方链接无效。');
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
  });
  register(commands.copyId, async target => {
    await vscode.env.clipboard.writeText(problemFor(target).id);
  });
  register(commands.editTags, async target => {
    const problem = target === undefined ? (await vscode.window.showQuickPick(problemsById(index.list()).map(item => ({
      label: problemTitle(item), description: item.source === 'lanqiao-course' ? '课程' : '蓝桥 OJ', problem: item,
    })), {title: '选择要管理标签的题目'}))?.problem : problemFor(target);
    if (problem) await editLocalProblemTags(index, problem);
  });
  register(commands.search, async () => {
    const problems = problemsById(index.list());
    if (!problems.length) {
      void vscode.window.showInformationMessage('暂无可搜索的本地蓝桥题目。');
      return;
    }
    const item = await vscode.window.showQuickPick(problems.map(problem => ({
      label: problemTitle(problem),
      description: [problemStatus(problem), problem.source === 'lanqiao-course' ? '课程' : '蓝桥 OJ'].join(' · '),
      detail: problem.tags.join(' · '),
      key: problem.key
    })), {title: '搜索本地题目', placeHolder: '题号、标题或标签', matchOnDescription: true, matchOnDetail: true});
    if (item) await open(problemFor(item.key));
  });
  register(commands.filter, async () => {
    const choices = [
      {label: '全部状态', value: undefined},
      ...statuses.map(value => ({label: statusLabels[value], value}))
    ].map(choice => ({...choice, ...(choice.value === filter ? {description: '当前筛选'} : {})}));
    const item = await vscode.window.showQuickPick(choices, {title: '按最近评测状态筛选本地题目'});
    if (!item) return;
    filter = item.value;
    refresh();
  });
  register(commands.migrate, async () => {
    const {found, added, skipped} = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: '正在导入已有蓝桥题目'
    }, migrate);
    void vscode.window.showInformationMessage(`扫描到 ${found} 题，新增 ${added} 题，跳过 ${skipped} 项。`);
  });
}
