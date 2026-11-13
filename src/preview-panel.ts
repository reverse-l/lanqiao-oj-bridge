import * as vscode from 'vscode';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {validateProblem,Problem} from './problem';
import {renderProblemPreview,PreviewAction,markdownCodeBlocks} from './preview';
import {parsePreviewMessage,parsePreviewState} from './preview-state';
import {rejectSymlinks} from './storage';
import type {SavedJob} from './result-card';
import type {ConnectionState} from './connection';

interface Entry {panel:vscode.WebviewPanel;source:string;problem:Problem;scrollY:number;disposables:vscode.Disposable[];refreshTimer?:NodeJS.Timeout;connection?:string;busy:boolean;revision:number;ready:boolean;actionText:string;blocks:string[]}
export class ProblemPreviews implements vscode.Disposable {
 private entries=new Map<string,Entry>();private timer:NodeJS.Timeout;private serializer:vscode.Disposable;
 constructor(private context:vscode.ExtensionContext,private onAction:(action:PreviewAction,source:string)=>Promise<string>,private connection:(id:string)=>ConnectionState,private latest:(id:string)=>SavedJob|undefined){
  this.serializer=vscode.window.registerWebviewPanelSerializer('lanqiao.problem',{deserializeWebviewPanel:async(panel,state)=>{
   const saved=parsePreviewState(state,this.knownSources());
   if(!saved){panel.webview.html='<p>无法安全恢复旧题面。请在本题 main.cpp 上重新运行「Lanqiao: 打开题面」。</p>';return;}
   try{await this.attach(panel,saved.source,saved.scrollY);}catch(error){panel.webview.html='<p>题目文件不可用，请从本题 main.cpp 重新打开题面。</p>';void vscode.window.showWarningMessage(`蓝桥题面恢复失败：${String(error)}`);}
  }});
  this.timer=setInterval(()=>this.refreshConnections(),1000);this.timer.unref();
 }
 private knownSources(){return this.context.workspaceState.get<string[]>('preview.sources',[]);}
 get activeSource(){return [...this.entries.values()].find(e=>e.panel.active)?.source;}
 private options(){return {enableScripts:true,enableCommandUris:false,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,'media'),vscode.Uri.joinPath(this.context.extensionUri,'dist')],retainContextWhenHidden:true};}
 async show(file:string){
  const source=path.join(path.dirname(path.resolve(file)),'main.cpp');
  const existing=this.entries.get(source);if(existing){existing.panel.reveal(vscode.ViewColumn.Two,true);return;}
  await rejectSymlinks(source);await rejectSymlinks(path.join(path.dirname(source),'.lanqiao.json'));
  const p=validateProblem(JSON.parse(await readFile(path.join(path.dirname(source),'.lanqiao.json'),'utf8')));
  await this.context.workspaceState.update('preview.sources',[...this.knownSources().filter(s=>s!==source),source].slice(-100));
  const panel=vscode.window.createWebviewPanel('lanqiao.problem',`蓝桥 ${p.id} · ${p.title}`,{viewColumn:vscode.ViewColumn.Two,preserveFocus:true},this.options());
  await this.attach(panel,source,0);
 }
 private async attach(panel:vscode.WebviewPanel,source:string,scrollY:number){
  await rejectSymlinks(source);await rejectSymlinks(path.join(path.dirname(source),'.lanqiao.json'));
  if(path.basename(source)!=='main.cpp')throw new Error('无效的题面来源');
  const problem=validateProblem(JSON.parse(await readFile(path.join(path.dirname(source),'.lanqiao.json'),'utf8')));
  panel.webview.options=this.options();panel.title=`蓝桥 ${problem.id} · ${problem.title}`;
  const e:Entry={panel,source,problem,scrollY,disposables:[],busy:false,revision:0,ready:false,actionText:'',blocks:[]};this.entries.set(source,e);
  e.disposables.push(panel.onDidDispose(()=>{clearTimeout(e.refreshTimer);for(const d of e.disposables)d.dispose();this.entries.delete(source);}));
  e.disposables.push(panel.webview.onDidReceiveMessage(async message=>{
   const m=parsePreviewMessage(message);if(!m)return;
   if('type' in m){if(m.type==='viewState')e.scrollY=m.scrollY;else {e.ready=true;const connection=this.connection(e.problem.id);e.connection=JSON.stringify(connection);await panel.webview.postMessage({type:'snapshot',connection,job:this.latest(e.problem.id),pending:e.busy,text:e.actionText});}return;}
   if(e.busy)return;e.busy=true;
   try{if(m.action==='copyBlock'){const content=e.blocks[m.index];if(content===undefined)throw new Error('样例已变化，请刷新题面后重试');await vscode.env.clipboard.writeText(content);e.actionText='已复制样例 / 代码块，保留原始空格和换行。';}else e.actionText=await this.onAction(m.action,source);await panel.webview.postMessage({type:'actionResult',text:e.actionText});}
   catch(error){e.actionText=`操作失败：${error instanceof Error?error.message:String(error)}`;await panel.webview.postMessage({type:'actionResult',text:e.actionText});}
   finally{e.busy=false;this.refreshConnections();}
  }));
  const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(source)),'README.md'));
  const changed=()=>{clearTimeout(e.refreshTimer);e.refreshTimer=setTimeout(()=>{void this.render(e).catch(error=>{void panel.webview.postMessage({type:'actionResult',text:`题面刷新失败：${String(error)}`});});},180);};
  e.disposables.push(watcher,watcher.onDidChange(changed),watcher.onDidCreate(changed));
  await this.render(e);
 }
 private async render(e:Entry){
  const revision=++e.revision,readme=path.join(path.dirname(e.source),'README.md');await rejectSymlinks(readme);
  const markdown=await readFile(readme,'utf8');if(e.revision!==revision)return;
  e.blocks=markdownCodeBlocks(markdown);
  const w=e.panel.webview,connection=this.connection(e.problem.id);e.connection=undefined;e.ready=false;
  w.html=renderProblemPreview({...e.problem,markdown},{nonce:randomBytes(18).toString('base64'),cspSource:w.cspSource,katexCss:w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'media','katex','katex.min.css')).toString(),clientJs:w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'dist','preview-client.js')).toString(),source:e.source,scrollY:e.scrollY,connection,job:this.latest(e.problem.id)});
 }
 refreshConnections(){for(const e of this.entries.values()){if(!e.ready)continue;const connection=this.connection(e.problem.id),key=JSON.stringify(connection);if(key!==e.connection){e.connection=key;void e.panel.webview.postMessage({type:'connection',connection});}}}
 update(job:SavedJob){for(const e of this.entries.values())if(e.ready&&e.problem.id===job.problemId)void e.panel.webview.postMessage({type:'jobResult',job});this.refreshConnections();}
 dispose(){clearInterval(this.timer);this.serializer.dispose();for(const e of this.entries.values()){clearTimeout(e.refreshTimer);for(const d of e.disposables)d.dispose();}this.entries.clear();}
}
