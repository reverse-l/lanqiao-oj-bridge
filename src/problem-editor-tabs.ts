import * as vscode from 'vscode';

export type TrackStatementTab = (tab: vscode.Tab, canClose: () => boolean) => void;

interface OpenOptions {
  sourceOptions: vscode.TextDocumentShowOptions;
  showStatement?: (track: TrackStatementTab) => Promise<boolean>;
  onSourceShown?: () => void | Promise<void>;
  afterOpen?: () => Promise<void>;
}

function isSourceTab(tab: vscode.Tab, document: vscode.TextDocument): boolean {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString();
}

export class ProblemEditorTabs {
  private pending = Promise.resolve();
  private previous?: {key: string; source?: vscode.Tab; statement?: vscode.Tab};
  private readonly ownership = new WeakMap<vscode.Tab, {group: vscode.TabGroup; canClose: () => boolean}>();

  open(key: string, document: vscode.TextDocument, options: OpenOptions): Promise<boolean | undefined> {
    const request = this.pending.then(() => this.show(key, document, options));
    this.pending = request.then(() => {}, () => {});
    return request;
  }

  private async show(key: string, document: vscode.TextDocument, options: OpenOptions): Promise<boolean | undefined> {
    const groups = vscode.window.tabGroups;
    const alreadyOpen = groups.all.some(group => group.tabs.some(tab => isSourceTab(tab, document)));
    const editor = await vscode.window.showTextDocument(document, options.sourceOptions);
    await options.onSourceShown?.();
    let statement: vscode.Tab | undefined;
    const statementShown = await options.showStatement?.((tab, canClose) => {
      statement = tab;
      if (!this.ownership.has(tab)) this.ownership.set(tab, {group: tab.group, canClose});
    });
    await options.afterOpen?.();
    const source = groups.all.find(group => group.viewColumn === editor?.viewColumn)?.tabs.find(tab => isSourceTab(tab, document));
    if (source && !alreadyOpen) {
      this.ownership.set(source, {group: source.group, canClose: () => !document.isDirty && isSourceTab(source, document)});
    }
    const previous = this.previous;
    this.previous = {key, source, statement: statement ?? (previous?.key === key && previous.source === source ? previous.statement : undefined)};
    const mode = vscode.workspace.getConfiguration('lanqiao', document.uri).get<string>('editorSwitchBehavior', 'smart');
    if (previous && previous.key !== key && mode !== 'keep') {
      if (previous.source && !isSourceTab(previous.source, document)) await this.close(previous.source, source, mode);
      await this.close(previous.statement, statement, mode);
    }
    return statementShown;
  }

  private async close(tab: vscode.Tab | undefined, replacement: vscode.Tab | undefined, mode: string): Promise<void> {
    if (!tab || tab === replacement) return;
    const owned = this.ownership.get(tab);
    if (!owned || tab.group !== owned.group || !vscode.window.tabGroups.all.includes(owned.group) ||
        !owned.group.tabs.includes(tab) || tab.isPinned || tab.isDirty || !owned.canClose()) return;
    if (mode !== 'closePrevious' && replacement?.group !== owned.group) return;
    // The native close API still handles changes between this check and the workbench closing the tab.
    await vscode.window.tabGroups.close(tab, true);
  }
}
