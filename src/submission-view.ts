import {lstat} from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {LANGUAGES, languageOfSource, problemSourceName} from './languages';
import type {LocalProblem, LocalProblemIndex} from './local-problems';
import {rejectSymlinks} from './storage';
import {selectReviewComparison, type ReviewStatus, type SubmissionSnapshot, type SubmissionStore} from './submission-store';

const snapshotScheme = 'lanqiao-submission';
const submissionLabels: Record<SubmissionSnapshot['status'], string> = {
  pending: '等待官方评测',
  accepted: '通过（AC）',
  wrong_answer: '答案错误（WA）',
  time_limit_exceeded: '超时（TLE）',
  memory_limit_exceeded: '内存超限（MLE）',
  runtime_error: '运行错误（RE）',
  compile_error: '编译错误（CE）',
  other: '其他结果',
  unknown: '结果未知',
  not_sent: '未发送',
};

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  needs_review: '待复盘', reviewing: '复盘中', reviewed: '已复盘',
};
export const reviewStatuses = Object.keys(reviewStatusLabels) as ReviewStatus[];

export function submissionStatus(status: SubmissionSnapshot['status'], officialStatus?: string): string {
  return status === 'other' && officialStatus ? `${submissionLabels[status]}（${officialStatus}）` : submissionLabels[status];
}

export function submissionTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {hour12: false});
}

export function submissionDetails(snapshot: SubmissionSnapshot): string {
  return [LANGUAGES[snapshot.language].label, submissionStatus(snapshot.status, snapshot.officialStatus),
    snapshot.durationMs === undefined ? '' : `${snapshot.durationMs} ms`,
    snapshot.memoryKb === undefined ? '' : `${snapshot.memoryKb} KB`].filter(Boolean).join(' · ');
}

function problemTitle(problem: LocalProblem): string {
  return `#${problem.id} ${problem.title}`;
}

function snapshotItem(snapshot: SubmissionSnapshot) {
  return {
    label: submissionTime(snapshot.createdAt),
    description: submissionDetails(snapshot),
    detail: snapshot.submissionId ? `官方提交 #${snapshot.submissionId}` : undefined,
    snapshot,
  };
}

async function currentSource(problem: LocalProblem, snapshot: SubmissionSnapshot, preferLinkedSource = false): Promise<string> {
  const directory = path.dirname(problem.localFilePath);
  const defaultSource = path.join(directory, LANGUAGES[snapshot.language].fileName);
  const numberedSource = path.join(directory, problemSourceName(problem.id, snapshot.language));
  const equivalent = path.join(directory, path.basename(snapshot.sourcePath));
  const candidates = new Set(preferLinkedSource ? [problem.localFilePath, equivalent, defaultSource, numberedSource] :
    [snapshot.sourcePath, equivalent, problem.localFilePath, defaultSource, numberedSource]);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || languageOfSource(candidate) !== snapshot.language) continue;
    try {
      await rejectSymlinks(candidate);
      if ((await lstat(candidate)).isFile()) return candidate;
    } catch { /* Try the next registered path if the solution moved. */ }
  }
  throw new Error(`找不到题目 #${problem.id} 的当前 ${LANGUAGES[snapshot.language].label} 源码。请恢复该文件或重新导入题目。\n${defaultSource}`);
}

type CommandTarget = {problemKey?: string; snapshotId?: string};

function targetKeys(target: unknown): CommandTarget {
  if (typeof target === 'string') return {problemKey: target};
  if (!target || typeof target !== 'object') return {};
  const keys: CommandTarget = {};
  if ('problemKey' in target && typeof target.problemKey === 'string') keys.problemKey = target.problemKey;
  if ('snapshotId' in target && typeof target.snapshotId === 'string') keys.snapshotId = target.snapshotId;
  return keys;
}

export function registerSubmissionCommands(
  context: vscode.ExtensionContext,
  index: LocalProblemIndex,
  store: SubmissionStore,
  currentProblemKey: () => Promise<string | undefined> = async () => undefined,
): void {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(snapshotScheme, {
    async provideTextDocumentContent(uri) {
      const id = uri.path.split('/')[1];
      if (!id) throw new Error('找不到提交快照，请重新选择提交记录。');
      return store.readCode(id);
    },
  }));

  const register = (command: string, run: (target: CommandTarget) => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(`lanqiao.${command}`, async (target?: unknown) => {
      try {
        await run(targetKeys(target));
      } catch (error) {
        void vscode.window.showErrorMessage(`Lanqiao：${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  };

  const requiredSnapshot = (id: string, problemKey?: string): SubmissionSnapshot => {
    const snapshot = store.get(id);
    if (!snapshot || (problemKey && snapshot.problemKey !== problemKey)) {
      throw new Error('找不到提交快照，请重新选择提交记录。');
    }
    return snapshot;
  };

  const pickProblem = async (target: CommandTarget): Promise<LocalProblem | undefined> => {
    const key = target.problemKey ?? (target.snapshotId ? requiredSnapshot(target.snapshotId).problemKey : undefined);
    if (key) {
      const problem = index.get(key);
      if (!problem) throw new Error('找不到本地题目记录，请重新导入题目。');
      return problem;
    }
    const active = await currentProblemKey().catch(() => undefined);
    const current = active ? index.get(active) : undefined;
    if (current) return current;
    const problems = index.list();
    if (!problems.length) {
      void vscode.window.showInformationMessage('暂无本地蓝桥题目，请先导入题目。');
      return;
    }
    const picked = await vscode.window.showQuickPick(problems.map(problem => ({label: problemTitle(problem),
      description: problem.source === 'lanqiao-course' ? '课程' : '蓝桥 OJ', problem})), {title: '选择本地题目'});
    return picked?.problem;
  };

  const pickSnapshot = async (snapshots: SubmissionSnapshot[], title: string): Promise<SubmissionSnapshot | undefined> => {
    if (!snapshots.length) {
      void vscode.window.showInformationMessage('这道题暂无提交快照。');
      return;
    }
    const picked = await vscode.window.showQuickPick(snapshots.map(snapshotItem), {title, matchOnDescription: true, matchOnDetail: true});
    return picked?.snapshot;
  };

  const snapshotDocument = (snapshot: SubmissionSnapshot) => vscode.workspace.openTextDocument(vscode.Uri.from({
    scheme: snapshotScheme,
    path: `/${snapshot.id}/提交快照-${submissionTime(snapshot.createdAt).replace(/[:/]/g, '-')}${path.extname(LANGUAGES[snapshot.language].fileName)}`,
  }));
  const showSnapshot = async (snapshot: SubmissionSnapshot) => {
    const document = await snapshotDocument(snapshot);
    await vscode.window.showTextDocument(document, {preview: false});
  };
  const openDiff = (left: vscode.Uri, right: vscode.Uri, problem: LocalProblem, comparison: string) =>
    vscode.commands.executeCommand('vscode.diff', left, right, `${problemTitle(problem)} · ${comparison}`, {preview: false});
  const showDiff = async (left: SubmissionSnapshot, right: SubmissionSnapshot, problem: LocalProblem,
    side = (snapshot: SubmissionSnapshot) => `${submissionTime(snapshot.createdAt)} ${LANGUAGES[snapshot.language].label}`) => {
    const [a, b] = await Promise.all([snapshotDocument(left), snapshotDocument(right)]);
    await openDiff(a.uri, b.uri, problem, `${side(left)} ↔ ${side(right)}`);
  };

  const showHistory = async (target: CommandTarget) => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const snapshot = await pickSnapshot(store.list(problem.key), `提交历史 · ${problemTitle(problem)}`);
    if (snapshot) await showSnapshot(requiredSnapshot(snapshot.id, problem.key));
  };
  register('submissionHistory', showHistory);
  register('openSubmission', async target => {
    if (target.snapshotId) await showSnapshot(requiredSnapshot(target.snapshotId, target.problemKey));
    else await showHistory(target);
  });
  register('compareCurrentSubmission', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const picked = target.snapshotId ? requiredSnapshot(target.snapshotId, problem.key) :
      await pickSnapshot(store.list(problem.key), `选择与当前代码比较的提交 · ${problemTitle(problem)}`);
    if (!picked) return;
    const snapshot = requiredSnapshot(picked.id, problem.key);
    const source = await currentSource(problem, snapshot);
    const document = await snapshotDocument(snapshot);
    await openDiff(document.uri, vscode.Uri.file(source), problem, `${submissionTime(snapshot.createdAt)} ↔ 当前 ${path.basename(source)}`);
  });
  register('compareFailureToAccepted', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const snapshots = store.list(problem.key);
    const comparison = selectReviewComparison(snapshots);
    if (!comparison) {
      const message = store.getReview(problem.key)?.lastFailure ? '失败提交的快照已不存在，无法对比。' :
        snapshots.length ? '该题没有可用于对比的失败提交记录。' : '该题暂无可用于对比的提交快照。';
      void vscode.window.showInformationMessage(message);
      return;
    }
    const {failed, accepted} = comparison;
    const verdict = (snapshot: SubmissionSnapshot) => submissionStatus(snapshot.status);
    // Recheck stored files even when VSCode already has the virtual documents open.
    await Promise.all((accepted ? [failed, accepted] : [failed]).map(snapshot => store.readCode(snapshot.id)));
    if (accepted) {
      await showDiff(failed, accepted, problem, verdict);
    } else {
      const source = await currentSource(problem, failed, true);
      const document = await snapshotDocument(failed);
      await openDiff(document.uri, vscode.Uri.file(source), problem, `${verdict(failed)} ↔ 当前 ${path.basename(source)}`);
    }
  });
  register('compareAdjacentSubmission', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    if (target.snapshotId) requiredSnapshot(target.snapshotId, problem.key);
    const snapshots = store.list(problem.key);
    if (snapshots.length < 2) {
      void vscode.window.showInformationMessage('比较相邻提交至少需要两条提交快照。');
      return;
    }
    const position = target.snapshotId ? snapshots.findIndex(snapshot => snapshot.id === target.snapshotId) : 0;
    const newer = Math.min(position, snapshots.length - 2);
    await showDiff(snapshots[newer + 1], snapshots[newer], problem);
  });
  register('compareSubmissions', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const snapshots = store.list(problem.key);
    if (snapshots.length < 2) {
      void vscode.window.showInformationMessage('比较两次提交至少需要两条提交快照。');
      return;
    }
    const left = target.snapshotId ? requiredSnapshot(target.snapshotId, problem.key) :
      await pickSnapshot(snapshots, `选择左侧提交 · ${problemTitle(problem)}`);
    if (!left) return;
    const right = await pickSnapshot(snapshots.filter(snapshot => snapshot.id !== left.id), `选择右侧提交 · ${problemTitle(problem)}`);
    if (right) await showDiff(requiredSnapshot(left.id, problem.key), requiredSnapshot(right.id, problem.key), problem);
  });
  register('deleteSubmission', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const snapshot = target.snapshotId ? requiredSnapshot(target.snapshotId, problem.key) :
      await pickSnapshot(store.list(problem.key), `选择要删除的快照 · ${problemTitle(problem)}`);
    if (!snapshot) return;
    if (snapshot.status === 'pending') throw new Error('这次提交仍在等待评测，请等结果返回后再删除。');
    const action = '删除快照';
    const choice = await vscode.window.showWarningMessage(`删除 ${problemTitle(problem)} 在 ${submissionTime(snapshot.createdAt)} 的本地快照？`,
      {modal: true, detail: '快照删除后无法恢复。'}, action);
    if (choice === action) await store.remove(snapshot.id);
  });
  register('cleanSubmissions', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const configured = vscode.workspace.getConfiguration('lanqiao').get<number>('snapshotRetention', 20);
    const keep = Number.isFinite(configured) ? Math.max(1, Math.min(200, Math.floor(configured))) : 20;
    const hasOld = store.list(problem.key).slice(keep).some(snapshot => snapshot.status !== 'pending');
    if (!hasOld) {
      void vscode.window.showInformationMessage('没有可清理的旧快照。');
      return;
    }
    const action = '清理旧快照';
    const choice = await vscode.window.showWarningMessage(`清理 ${problemTitle(problem)} 的旧快照？`,
      {modal: true, detail: `会保留最近 ${keep} 条及等待评测的快照。快照删除后无法恢复。`}, action);
    if (choice !== action) return;
    const removed = await store.clean(problem.key, keep);
    void vscode.window.showInformationMessage(`已清理 ${removed} 条旧快照。`);
  });

  register('reviewErrors', async () => {
    const items = store.listReviews().flatMap(review => {
      const problem = index.get(review.problemKey);
      if (!problem) return [];
      const description = [reviewStatusLabels[review.status], review.lastFailure ? submissionStatus(review.lastFailure.status) : '']
        .filter(Boolean).join(' · ');
      return [{label: problemTitle(problem), description, problemKey: problem.key}];
    });
    if (!items.length) {
      void vscode.window.showInformationMessage('暂无错题复盘记录。可从本地题目菜单手动加入。');
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {title: '错题复盘', matchOnDescription: true});
    if (picked) await vscode.commands.executeCommand('lanqiao.openLocalSource', picked.problemKey);
  });
  register('addReview', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    if (store.getReview(problem.key)) {
      void vscode.window.showInformationMessage(`${problemTitle(problem)} 已在错题复盘中。`);
      return;
    }
    await store.ensureReview(problem.key);
    void vscode.window.showInformationMessage(`${problemTitle(problem)} 已加入待复盘。`);
  });
  register('editReviewNote', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    await store.ensureReview(problem.key);
    const document = await vscode.workspace.openTextDocument(await store.noteFile(problem.key));
    await vscode.window.showTextDocument(document, {preview: false});
  });
  register('setReviewStatus', async target => {
    const problem = await pickProblem(target);
    if (!problem) return;
    const current = store.getReview(problem.key)?.status;
    const choice = await vscode.window.showQuickPick(reviewStatuses.map(status => ({label: reviewStatusLabels[status],
      description: status === current ? '当前状态' : undefined, status})), {title: `设置复盘状态 · ${problemTitle(problem)}`});
    if (choice) await store.setReview(problem.key, choice.status);
  });
  register('markReviewDone', async target => {
    const problem = await pickProblem(target);
    if (problem) await store.setReview(problem.key, 'reviewed');
  });
}
