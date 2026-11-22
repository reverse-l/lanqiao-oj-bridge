import * as vscode from 'vscode';
import {lstat,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {validateProblem,Problem} from './problem';
import {renderProblemPreview,PreviewAction,markdownCodeBlocks} from './preview';
import {parsePreviewMessage,parsePreviewState} from './preview-state';
import {rejectSymlinks} from './storage';
import type {ConnectionState} from './connection';
import {languageOfSource,LANGUAGES} from './languages';
import type {TrackStatementTab} from './problem-editor-tabs';

interface Entry {panel:vscode.WebviewPanel;tab?:vscode.Tab;source:string;statement:string;problem:Problem;scrollY:number;disposables:vscode.Disposable[];watchers:vscode.Disposable[];refreshTimer?:NodeJS.Timeout;connection?:string;busy:boolean;revision:number;ready:boolean;actionText:string;blocks:string[]}
const problemViewType = 'lanqiao.problem';
const panelTitle = (problem: Problem, source: string) =>
 `蓝桥 ${problem.id} · ${problem.title} · ${LANGUAGES[languageOfSource(source)!].label}`;

async function waitForPanelTab(title:string,before:Set<vscode.Tab>):Promise<vscode.Tab|undefined> {
 const groups = vscode.window.tabGroups;
 const match = () => {
  const candidates = groups.all.flatMap(group => group.tabs).filter(tab => !before.has(tab) && tab.label === title &&
   tab.input instanceof vscode.TabInputWebview &&
   (tab.input.viewType === problemViewType || tab.input.viewType === `mainThreadWebview-${problemViewType}`));
  return candidates.length === 1 ? candidates[0] : undefined;
 };
 const immediate = match();
 if (immediate) return immediate;
 // The workbench may publish the tab model after the webview is rendered.
 return new Promise(resolve => {
  const finish = (tab?:vscode.Tab) => {listener.dispose();clearTimeout(timer);resolve(tab);};
  const listener = groups.onDidChangeTabs(() => {const tab = match();if (tab) finish(tab);});
  const timer = setTimeout(() => finish(match()), 250);
 });
}

async function findStatement(source: string, linked?: string): Promise<string | undefined> {
 const directory = path.dirname(source);
 const candidates = new Set([linked, linked ? path.join(directory, path.basename(linked)) : undefined, path.join(directory, 'README.md')]);
 for (const file of candidates) {
  if (!file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.md') continue;
  try {
   await rejectSymlinks(file);
   if ((await lstat(file)).isFile()) return file;
  } catch (error) {
   const {code} = error as NodeJS.ErrnoException;
   if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
  }
 }
}

export class ProblemPreviews implements vscode.Disposable {
 private entries=new Map<string,Entry>();private timer:NodeJS.Timeout;private serializer:vscode.Disposable;
 private pending = Promise.resolve();
 constructor(private context:vscode.ExtensionContext,private onAction:(action:Exclude<PreviewAction,'copyMarkdown'>,source:string)=>Promise<string>,private connection:(id:string,source:string)=>ConnectionState,
  private linkedStatement: (source: string, problemId: string) => string | undefined = () => undefined){
  this.serializer=vscode.window.registerWebviewPanelSerializer(problemViewType,{deserializeWebviewPanel:(panel,state)=>this.serialize(async()=>{
   const saved=parsePreviewState(state,this.knownSources());
   if(!saved){panel.webview.html='<p>无法安全恢复旧题面。请在本题 C / C++ 文件 上重新运行「Lanqiao: 打开题面」。</p>';return;}
   if (this.entries.has(saved.source)) { panel.dispose(); return; }
   try {
    const problem = await this.loadProblem(saved.source);
    const statement = await findStatement(saved.source, this.linkedStatement(saved.source, problem.id));
    if (!statement) { panel.dispose(); return; }
    await this.attach(panel, saved.source, problem, statement, saved.scrollY);
   } catch (error) {
    panel.dispose();
    void vscode.window.showWarningMessage(`蓝桥题面恢复失败：${String(error)}`);
   }
  })});
  this.timer=setInterval(()=>this.refreshConnections(),1000);this.timer.unref();
 }
 private knownSources(){return this.context.workspaceState.get<string[]>('preview.sources',[]);}
 get activeSource(){return [...this.entries.values()].find(e=>e.panel.active)?.source;}
 private options(){return {enableScripts:true,enableCommandUris:false,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,'media'),vscode.Uri.joinPath(this.context.extensionUri,'dist')],retainContextWhenHidden:true};}
 private serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = this.pending.then(action);
  this.pending = result.then(() => {}, () => {});
  return result;
 }
 private reportTab(entry:Entry, track?:TrackStatementTab):void {
  if (!entry.tab || !track) return;
  track(entry.tab, () => this.entries.get(entry.source) === entry && !entry.busy &&
   !vscode.workspace.textDocuments.some(doc => doc.isDirty && doc.uri.scheme === 'file' && path.relative(entry.statement,doc.uri.fsPath) === ''));
 }
 show(file: string, linked?: string, track?:TrackStatementTab): Promise<boolean> {
  const source = path.resolve(file);
  return this.serialize(async () => {
   const existing = this.entries.get(source);
   if (existing) {
    if (linked && linked !== existing.statement) {
     const statement = await findStatement(source, linked);
     if (statement && statement !== existing.statement) {
      existing.statement = statement;
      this.watchStatement(existing);
      await this.render(existing);
     }
    }
    // Preserve the live webview, including its scroll position, and keep focus in the source editor.
    existing.panel.reveal(vscode.ViewColumn.Two, true);
    this.reportTab(existing, track);
    return true;
   }
   const problem = await this.loadProblem(source);
   const statement = await findStatement(source, linked ?? this.linkedStatement(source, problem.id));
   if (!statement) return false;
   await this.context.workspaceState.update('preview.sources',[...this.knownSources().filter(s=>s!==source),source].slice(-100));
   const before = track ? new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs)) : undefined;
   const title = panelTitle(problem,source);
   const panel = vscode.window.createWebviewPanel(problemViewType, title,
    {viewColumn: vscode.ViewColumn.Two, preserveFocus: true}, this.options());
   try {
    const entry = await this.attach(panel, source, problem, statement, 0);
    if (before) {
     // Only an unambiguous tab created with this panel can belong to the switching workflow.
     entry.tab = await waitForPanelTab(title,before);
     this.reportTab(entry, track);
    }
   }
   catch (error) { panel.dispose(); throw error; }
   return true;
  });
 }
 private async loadProblem(source: string): Promise<Problem> {
  if (!languageOfSource(source)) throw new Error('请选择 C / C++ 源码文件');
  const metadata = path.join(path.dirname(source), '.lanqiao.json');
  await rejectSymlinks(source); await rejectSymlinks(metadata);
  return validateProblem(JSON.parse(await readFile(metadata, 'utf8')));
 }
 private async attach(panel:vscode.WebviewPanel,source:string,problem:Problem,statement:string,scrollY:number){
  panel.webview.options=this.options();panel.title=panelTitle(problem,source);
  const e:Entry={panel,source,statement,problem,scrollY,disposables:[],watchers:[],busy:false,revision:0,ready:false,actionText:'',blocks:[]};this.entries.set(source,e);
  e.disposables.push(panel.onDidDispose(()=>{this.clean(e);this.entries.delete(source);}));
  e.disposables.push(panel.webview.onDidReceiveMessage(async message=>{
   const m=parsePreviewMessage(message);if(!m)return;
   if('type' in m){if(m.type==='viewState')e.scrollY=m.scrollY;else {e.ready=true;const connection=this.connection(e.problem.id,e.source);e.connection=JSON.stringify(connection);await panel.webview.postMessage({type:'snapshot',connection,pending:e.busy,text:e.actionText});}return;}
   if(e.busy)return;e.busy=true;
   try{if(m.action==='copyBlock'){const content=e.blocks[m.index];if(content===undefined)throw new Error('样例已变化，请刷新题面后重试');await vscode.env.clipboard.writeText(content);e.actionText='已复制';}
    else if (m.action === 'copyMarkdown') { await rejectSymlinks(e.statement); await vscode.env.clipboard.writeText(await readFile(e.statement, 'utf8')); e.actionText = '已复制题面 Markdown'; }
    else e.actionText=await this.onAction(m.action,source);await panel.webview.postMessage({type:'actionResult',text:e.actionText,level:'success'});e.actionText='';}
   catch(error){e.actionText=`操作失败：${error instanceof Error?error.message:String(error)}`;await panel.webview.postMessage({type:'actionResult',text:e.actionText,level:'error'});}
   finally{e.busy=false;this.refreshConnections();}
  }));
  this.watchStatement(e);
  await this.render(e);
  return e;
 }
 private watchStatement(e: Entry) {
  clearTimeout(e.refreshTimer);
  for (const d of e.watchers) d.dispose();
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(e.statement)), '*'));
  const changed = (uri: vscode.Uri) => {
   if (path.resolve(uri.fsPath) !== path.resolve(e.statement)) return;
   clearTimeout(e.refreshTimer);
   e.refreshTimer = setTimeout(() => { void this.render(e).catch(error => {
    void e.panel.webview.postMessage({type:'actionResult',text:`题面刷新失败：${String(error)}`});
   }); }, 180);
  };
  e.watchers = [watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed)];
 }
 private clean(e: Entry) {
  clearTimeout(e.refreshTimer);
  e.revision++;
  for (const d of [...e.disposables, ...e.watchers]) d.dispose();
 }
 private async render(e:Entry){
  const revision=++e.revision,readme=e.statement;await rejectSymlinks(readme);
  const markdown=await readFile(readme,'utf8');if(e.revision!==revision)return;
  e.blocks=markdownCodeBlocks(markdown);
  const w=e.panel.webview,connection=this.connection(e.problem.id,e.source);e.connection=undefined;e.ready=false;
  w.html=renderProblemPreview({...e.problem,markdown},{nonce:randomBytes(18).toString('base64'),cspSource:w.cspSource,katexCss:w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'media','katex','katex.min.css')).toString(),clientJs:w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'dist','preview-client.js')).toString(),source:e.source,scrollY:e.scrollY,connection});
 }
 refreshConnections(){for(const e of this.entries.values()){if(!e.ready)continue;const connection=this.connection(e.problem.id,e.source),key=JSON.stringify(connection);if(key!==e.connection){e.connection=key;void e.panel.webview.postMessage({type:'connection',connection});}}}
 dispose(){clearInterval(this.timer);this.serializer.dispose();for(const e of this.entries.values())this.clean(e);this.entries.clear();}
}
