import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {languageOfSource} from './languages';
import {normalizeTags, type LocalProblem, type LocalProblemIndex} from './local-problems';
import {rejectSymlinks} from './storage';
import {validateProblem} from './problem';
import {ProblemEditorTabs, type TrackStatementTab} from './problem-editor-tabs';

async function isRegularFile(file: string): Promise<boolean> {
  await rejectSymlinks(file);
  try { return (await lstat(file)).isFile(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function relinkStatement(index: LocalProblemIndex, problem: LocalProblem): Promise<void> {
  const link = '关联题面';
  const result = await vscode.window.showWarningMessage(`找不到题目 #${problem.id} 的 Markdown 题面，源码已打开。`, link);
  if (result !== link) return;
  const picked = await vscode.window.showOpenDialog({title: '选择这道题的 Markdown 题面', canSelectMany: false,
    filters: {Markdown: ['md']}, defaultUri: vscode.Uri.file(path.dirname(problem.localFilePath))});
  if (!picked?.length) return;
  const file = picked[0];
  if (file.scheme !== 'file' || !await isRegularFile(file.fsPath)) throw new Error('请选择存在的本地 Markdown 文件');
  await index.setMarkdownPath(problem.key, file.fsPath);
  void vscode.window.showInformationMessage('题面已关联，下次打开题目时会显示预览。');
}

async function relinkSource(index: LocalProblemIndex, problem: LocalProblem): Promise<void> {
  const link = '关联源码';
  const result = await vscode.window.showErrorMessage(
    `找不到题目 #${problem.id} 的 C / C++ 源码。请恢复该文件或重新导入题目。\n${problem.localFilePath}`, link);
  if (result !== link) return;
  const picked = await vscode.window.showOpenDialog({title: '选择这道题的 C / C++ 源码', canSelectMany: false,
    filters: {'C / C++': ['c', 'cpp']}, defaultUri: vscode.Uri.file(path.dirname(problem.localFilePath))});
  if (!picked?.length) return;
  const file = picked[0];
  if (file.scheme !== 'file' || !languageOfSource(file.fsPath) || !await isRegularFile(file.fsPath)) {
    throw new Error('请选择存在的本地 C / C++ 源码');
  }
  const metadata = path.join(path.dirname(file.fsPath), '.lanqiao.json');
  if (!await isRegularFile(metadata) || validateProblem(JSON.parse(await readFile(metadata, 'utf8'))).id !== problem.id) {
    throw new Error('所选源码需要与本题的 .lanqiao.json 位于同一目录');
  }
  await index.setSourcePath(problem.key, file.fsPath);
  void vscode.window.showInformationMessage('源码已关联，下次打开题目时会使用新位置。');
}

export type ShowProblemStatement = (source: string, linkedStatement?: string, track?: TrackStatementTab) => Promise<boolean>;

export async function openLocalProblem(index: LocalProblemIndex, problem: LocalProblem, showStatement: ShowProblemStatement,
  onOpen?: (problem: LocalProblem) => void | Promise<void>, tabs = new ProblemEditorTabs()): Promise<void> {
  const source = problem.localFilePath;
  if (!path.isAbsolute(source) || !languageOfSource(source) || !await isRegularFile(source).catch(() => false)) {
    void relinkSource(index, problem).catch(error => {
      void vscode.window.showErrorMessage(`无法关联源码：${error instanceof Error ? error.message : String(error)}`);
    });
    return;
  }
  const document = await vscode.workspace.openTextDocument(source);
  const beside = vscode.workspace.getConfiguration('lanqiao', document.uri).get('openMarkdownBesideSource', true);
  const sourceOptions = beside ? {viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false} : {preview: false};
  const shown = await tabs.open(problem.key, document, {
    sourceOptions,
    onSourceShown: () => onOpen?.(problem),
    showStatement: beside ? track => showStatement(document.fileName ?? source, problem.markdownFilePath, track) : undefined,
  });
  if (shown === false) {
    void relinkStatement(index, problem).catch(error => {
      void vscode.window.showErrorMessage(`无法关联题面：${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

type TagChoice = {action: 'save' | 'add'; selected: string[]};

function chooseTags(problem: LocalProblem, options: string[], selected: string[]): Promise<TagChoice | undefined> {
  return new Promise(resolve => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const add = {iconPath: new vscode.ThemeIcon('add'), tooltip: '创建新标签'};
    let settled = false;
    const end = (action?: TagChoice['action']) => {
      if (settled) return;
      settled = true;
      const result = action ? {action, selected: picker.selectedItems.map(item => item.label)} : undefined;
      picker.dispose();
      resolve(result);
    };
    const selectedKeys = new Set(selected.map(tag => tag.toLowerCase()));
    picker.title = `管理题目标签 · #${problem.id} ${problem.title}`;
    picker.placeholder = '多选后按回车保存，点击右上角 + 新建标签';
    picker.canSelectMany = true;
    picker.buttons = [add];
    picker.items = options.map(label => ({label}));
    picker.selectedItems = picker.items.filter(item => selectedKeys.has(item.label.toLowerCase()));
    picker.onDidTriggerButton(() => end('add'));
    picker.onDidAccept(() => end('save'));
    picker.onDidHide(() => end());
    picker.show();
  });
}

export async function editLocalProblemTags(index: LocalProblemIndex, problem: LocalProblem): Promise<void> {
  let selected = problem.tags;
  let additions: string[] = [];
  for (;;) {
    const options = normalizeTags([...problem.tags, ...index.list().flatMap(item => item.tags), ...additions])
      .sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const choice = await chooseTags(problem, options, selected);
    if (!choice) return;
    if (choice.action === 'save') {
      await index.setTags(problem.key, choice.selected);
      return;
    }
    const input = await vscode.window.showInputBox({title: '创建新标签', prompt: '输入标签名，多个标签可用逗号分隔'});
    const created = input?.split(/[,，]/) ?? [];
    additions = normalizeTags([...additions, ...created]);
    selected = normalizeTags([...choice.selected, ...created]);
  }
}
