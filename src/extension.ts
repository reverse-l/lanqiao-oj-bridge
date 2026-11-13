import * as vscode from 'vscode';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {BridgeServer,Job,JobKind} from './bridge';
import {importProblem,ensureCphProblem,restoreEmptyCphProblem,rejectSymlinks} from './storage';
import {Problem,validateProblem} from './problem';
import {formatResult,usesInputDebug} from './output';
import {ProblemPreviews} from './preview-panel';
import {samplesFromMarkdown} from './sample-markdown';
import {recoverHistory} from './result-card';
import {connectionState} from './connection';
import {LanguageId,LANGUAGES,languageOfSource,requireLanguage} from './languages';

const expand=(p:string)=>p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):path.resolve(p);
let bridge:BridgeServer|undefined;
export async function activate(context:vscode.ExtensionContext){
 const output=vscode.window.createOutputChannel('Lanqiao OJ');context.subscriptions.push(output);
 const config=()=>vscode.workspace.getConfiguration('lanqiao');
 let token=await context.secrets.get('browser-token');if(!token){token=randomBytes(32).toString('hex');await context.secrets.store('browser-token',token);}
 let history=recoverHistory(context.globalState.get('history',[]),false);
 const latest=(id:string,source?:string)=>history.filter(j=>j.problemId===id&&(!source||(j.language||'cpp')===languageOfSource(source)&&(!j.sourceName||j.sourceName===path.basename(source)))).at(-1);
 const templateFor=(language:LanguageId)=>language==='cpp'?expand(config().get<string>('template')!):expandOptional(config().get<string>('cTemplate',''));
 const connectionFor=(id:string,source:string)=>bridge?.connection(id,languageOfSource(source)||'cpp')||connectionState(false,id,[],false);
 const previews:ProblemPreviews=new ProblemPreviews(context,async(action,source):Promise<string>=>{
  if(action==='copyMarkdown'){const file=path.join(path.dirname(source),'README.md');await rejectSymlinks(file);await vscode.env.clipboard.writeText(await readFile(file,'utf8'));return '已复制完整题面 Markdown（当前保存的 README），可粘贴给 AI。';}
  if(action==='switchLanguage'){await switchLanguage(source);return '已打开所选语言解法；已有文件全部保留。';}
  if(action==='sendToCph')return sendToCph(source);
  if(action==='localTest'){await sendToCph(source,true);await vscode.commands.executeCommand('cph.runTestCases');return '已交给 CPH 使用现有编译配置运行本地样例。';}
  if(action==='open'){const {p}=await current(false,source);await vscode.env.openExternal(vscode.Uri.parse(p.url));return '已打开这道题的蓝桥官方页面。';}
  if(action==='recent'){const {p}=await current(false,source);const text=recentText(p.id,source);output.appendLine(text);return text;}
  if(action==='pair'){await vscode.commands.executeCommand('lanqiao.pair');return '已打开浏览器配对与脚本安装说明。';}
  if(action==='check'){const {p}=await current(false,source);bridge!.recheck(p.id);previews.refreshConnections();return '已重新检测，请保持本题网页打开。登录状态将以实际官方响应为准。';}
  if(action==='copyOutput'||action==='copyError'||action==='copyId'){
   const {p}=await current(false,source),r=latest(p.id,source)?.result;
   const value=action==='copyOutput'?r?.stdout:action==='copyError'?r?.stderr:r?.submissionId;
   if(value===undefined)throw new Error('平台没有提供该字段');await vscode.env.clipboard.writeText(value);return '已复制平台原始内容。';
  }
  const id=await queue(action,source);return id?'已进入本地队列，等待对应蓝桥网页执行；结果将显示在这里和输出面板。':'操作已取消。';
 },connectionFor,latest);context.subscriptions.push(previews);
 const persist=(job:Job)=>{
  const {code,input,...safe}=job;
  history=history.filter(j=>j.id!==job.id);history.push(safe);history=history.slice(-50);void context.globalState.update('history',history);
  output.appendLine(`\n[${new Date().toLocaleString()}] ${job.kind==='debug'?'OJ 在线调试':job.kind==='submit'?'正式提交':'网页填入'} #${job.problemId} · ${LANGUAGES[job.language||'cpp'].label} · ${job.sourceName||'main.cpp'}：${job.result?.phase||job.state}`);
  if(job.result)output.appendLine(formatResult(job.result,usesInputDebug(job)));
  previews.update(job);
  if(job.state==='finished'||job.state==='expired'){
   const label=job.kind==='debug'?'官方在线调试':'正式提交';
   if(job.result?.phase==='done')void vscode.window.showInformationMessage(`${label} #${job.problemId}：${usesInputDebug(job)?'执行已结束，请查看输出':job.result.status||job.result.message||'已完成'}`);
   else if(job.result?.phase!=='prepared')void vscode.window.showWarningMessage(job.result?.message||'未取得可靠结果，请查看官方网页');
  }
 };
 bridge=new BridgeServer({token,onUpdate:persist,onImport:async p=>{
  const root=expand(config().get<string>('root')!),language=requireLanguage(config().get<string>('defaultLanguage','cpp')),template=templateFor(language);
  const cph=expandOptional(vscode.workspace.getConfiguration('cph').get<string>('general.saveLocation',''));
  const result=await importProblem(root,template,p,cph,language);
  const extension=vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper');if(extension)await extension.activate();
  const doc=await vscode.workspace.openTextDocument(result.source);await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preview:false});
  await previews.show(result.source);
  if(extension)await vscode.commands.executeCommand('cph.judgeView.focus');
  // 预览 webview 与 CPH 聚焦后，明确把编辑焦点交回源码，触发 CPH 的 editorChanged。
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
  output.appendLine(`导入 #${p.id}：${result.source}；${result.samples} 组样例；${result.created?'从现有模板创建':'复用已有代码，全部已有文件保留'}`);
  if(!p.tests.length)void vscode.window.showWarningMessage(`题目 ${p.id} 未提取到样例，请查看题面并手动补充 CPH。`);
  return {created:result.created,id:p.id,samples:result.samples};
 }});
 const port=config().get<number>('port',27124);
 try{await bridge.listen(port);history=recoverHistory(context.globalState.get('history',[]),true);await context.globalState.update('history',history);output.appendLine(`Bridge 已启动：127.0.0.1:${port}（与 CPH 27121 独立）`);}
 catch(e){output.appendLine(String(e));void vscode.window.showWarningMessage(`Lanqiao Bridge 无法监听 ${port}，可能另一个 VSCode 窗口已启动。请在那个窗口操作，或更改 Lanqiao 端口。`);}
 context.subscriptions.push({dispose:()=>{void bridge?.close();}});
 async function current(save=false,target?:string):Promise<{file:string;p:Problem;code:string;sha:string;language:LanguageId}>{
  const editor=vscode.window.activeTextEditor;
  const editorFile=editor?.document.uri.scheme==='file'?editor.document.fileName:undefined;
  const file=target||(editorFile&&languageOfSource(editorFile)?editorFile:previews.activeSource),language=file?languageOfSource(file):undefined;
  if(!file||!language)throw new Error('请先打开已导入题目目录内的 C / C++ 文件或蓝桥题面预览');
  await rejectSymlinks(file);await rejectSymlinks(path.join(path.dirname(file),'.lanqiao.json'));
  let p=validateProblem(JSON.parse(await readFile(path.join(path.dirname(file),'.lanqiao.json'),'utf8')));
  if(!p.tests.length){const recovered=samplesFromMarkdown(await readFile(path.join(path.dirname(file),'README.md'),'utf8'));if(recovered.length)p={...p,tests:recovered};}
  const document=await vscode.workspace.openTextDocument(file);
  if(save&&document.isDirty&&!await document.save())throw new Error('当前代码保存失败，已取消操作');
  const code=await readFile(file,'utf8');return {file,p,code,language,sha:createHash('sha256').update(code).digest('hex')};
 }
 async function sendToCph(source?:string,requireSamples=false):Promise<string>{
  const {file,p}=await current(requireSamples,source),extension=vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper');
  if(!extension)throw new Error('未找到现有 CPH 扩展，请先启用 CPH');await extension.activate();
  const location=expandOptional(vscode.workspace.getConfiguration('cph',vscode.Uri.file(file)).get<string>('general.saveLocation',''));
  const result=await ensureCphProblem(p,file,location);
  let tests=JSON.parse(await readFile(result.path,'utf8')).tests,restored=false;
  if(Array.isArray(tests)&&!tests.length&&p.tests.length){
   const answer=await vscode.window.showWarningMessage(`这道题的旧 CPH 记录没有样例，已从保存的题面找到 ${p.tests.length} 组。\n文件：${result.path}\n将先保存 .before-samples.bak 备份，再恢复空样例；源码和题面不变。`,{modal:true},'备份并恢复样例');
   if(answer==='备份并恢复样例'){restored=(await restoreEmptyCphProblem(p,file,location)).restored;tests=JSON.parse(await readFile(result.path,'utf8')).tests;}
  }
  if(requireSamples&&(!Array.isArray(tests)||!tests.length))throw new Error('当前 CPH 没有样例；请先恢复题面样例或手动添加。');
  const doc=await vscode.workspace.openTextDocument(file);await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preview:false});
  await vscode.commands.executeCommand('cph.judgeView.focus');await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
  return `已发送至 CPH：${p.id}《${p.title}》 · ${path.basename(file)}\n${restored?`已备份旧记录并恢复 ${p.tests.length} 组样例`:result.created?`已加载 ${p.tests.length} 组题面样例`:tests?.length?'已复用现有测试，保留自定义样例':'当前没有样例，请恢复题面样例或手动添加'}。`;
 }
 function recentText(id?:string,source?:string){const jobs=history.filter(j=>(!id||j.problemId===id)&&(!source||(j.language||'cpp')===languageOfSource(source)&&(!j.sourceName||j.sourceName===path.basename(source)))).slice(-10);return jobs.length?jobs.map(job=>`\n${job.kind==='debug'?'官方在线调试（自测）':job.kind==='submit'?'正式提交':'网页填入'} #${job.problemId} · ${LANGUAGES[job.language||'cpp'].label} · ${job.sourceName||'main.cpp'}\n${job.result?formatResult(job.result,usesInputDebug(job)):job.state}`).join('\n'):'本扩展还没有这道题的运行或提交记录，可在蓝桥原题页查看官方历史。';}
 async function openCurrent(){const {p}=await current();await vscode.env.openExternal(vscode.Uri.parse(p.url));}
 async function queue(kind:JobKind,target?:string){
  const {file,p,language}=await current(true,target);let input:string|undefined,debugMode:'input'|'official'|undefined;
  const connection=bridge!.connection(p.id,language);if(!connection.canRunOnline)throw new Error(`${connection.label}：${connection.detail}`);
  if(kind==='debug'){
   const choices=[...p.tests.map((s,i)=>({label:`样例 ${i+1}`,description:s.input.slice(0,70).replace(/\n/g,' '),value:s.input,mode:'input' as const})),{label:'选择自定义输入文件',description:'纯文本文件；原样交给官方自测',value:undefined,mode:'input' as const},{label:'调试',description:'使用官方调试方式（不传自定义输入）',value:'',mode:'official' as const}];
   const pick=await vscode.window.showQuickPick(choices,{ignoreFocusOut:true,title:`OJ 官方在线调试 #${p.id} — ${LANGUAGES[language].officialLabel}；本地使用现有 CPH 配置`});if(!pick)return;
   debugMode=pick.mode;
   if(pick.value===undefined){const paths=await vscode.window.showOpenDialog({canSelectMany:false,title:'选择官方在线调试输入文件'});if(!paths?.[0])return;input=await readFile(paths[0].fsPath,'utf8');}else input=pick.value;
  }
  const {code,sha}=await current(true,file);
  if(kind==='submit'){
   const answer=await vscode.window.showWarningMessage(`正式提交到蓝桥 OJ #${p.id}《${p.title}》\n文件：${file}\n语言：官方 ${LANGUAGES[language].officialLabel}；本地使用现有 CPH ${LANGUAGES[language].label} 配置\nSHA-256：${sha}\n将使用已登录浏览器账户创建真实评测记录。`,{modal:true},'确认提交');
   if(answer!=='确认提交')return;
   if(await readFile(file,'utf8')!==code)throw new Error('确认期间文件已变化，请重新提交以确认最新代码');
  }
  const job=bridge!.enqueue({kind,problemId:p.id,code,input,debugMode,language,sourceName:path.basename(file)});
  output.appendLine(`\n${kind==='debug'?'OJ 在线调试':kind==='submit'?'正式提交':'网页填入'} #${p.id} 已进入本地队列；${file}\nSHA-256 ${sha}\n请保持已配对的对应题目网页打开。`);output.show(true);
  // 避免在未配对时自动把包含代码的任务交给新网页；只打开无令牌的题目 URL。
  if(Date.now()-bridge!.lastBrowserSeen>10_000){void vscode.window.showInformationMessage('请在对应蓝桥网页安装脚本并配对，然后保持页面打开。');await vscode.env.openExternal(vscode.Uri.parse(p.url));}
  return job.id;
 }
 async function switchLanguage(source?:string){
  const {file,p,language}=await current(false,source);
  const pick=await vscode.window.showQuickPick((['cpp','c'] as const).map(value=>({label:LANGUAGES[value].label,description:LANGUAGES[value].fileName+(value===language?'（当前）':''),value})),{title:'选择本题解题语言；已有文件保持原样',ignoreFocusOut:true});if(!pick)return;
  const location=expandOptional(vscode.workspace.getConfiguration('cph',vscode.Uri.file(file)).get<string>('general.saveLocation',''));
  const result=await importProblem(path.dirname(path.dirname(file)),templateFor(pick.value),p,location,pick.value);
  const doc=await vscode.workspace.openTextDocument(result.source);await previews.show(result.source);await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preview:false});
  if(vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper'))await sendToCph(result.source);
 }
 const commands:Record<string,()=>unknown>={
  preview:async()=>{
   const uri=vscode.window.activeTextEditor?.document.uri;let source=uri?.scheme==='file'&&languageOfSource(uri.fsPath)?uri.fsPath:previews.activeSource;
   if(!source&&uri?.scheme==='file'&&path.basename(uri.fsPath)==='README.md'){
    const choices=[];for(const language of ['cpp','c'] as const){const file=path.join(path.dirname(uri.fsPath),LANGUAGES[language].fileName);try{await readFile(file);choices.push({label:LANGUAGES[language].label,description:LANGUAGES[language].fileName,file});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    source=choices.length===1?choices[0].file:(await vscode.window.showQuickPick(choices,{title:'选择题面绑定的解法'}))?.file;
   }
   if(!source)throw new Error('请先打开已导入题目的 C / C++ 文件或 README.md');await previews.show(source);
  },
  switchLanguage:()=>switchLanguage(),
  sendToCph:()=>sendToCph(),
  pair:async()=>{
   const pairing=bridge!.createPairing();
   output.appendLine('配对说明：令牌只存 SecretStorage / GM 隔离存储；配对码 5 分钟有效且只用一次。');
   const doc=await vscode.workspace.openTextDocument({language:'markdown',content:`# Lanqiao OJ Bridge 浏览器配对\n\n1. 安装扩展随附的 dist/lanqiao-bridge.user.js 到 Tampermonkey。\n2. 打开蓝桥题目页，点击左下角「配对」。\n3. 输入下方一次性配对码（5 分钟有效），不要输入蓝桥 Cookie、JWT 或密码。\n\n端口：${port}\n\n配对码：${pairing.code}\n\n脚本路径：${context.asAbsolutePath('dist/lanqiao-bridge.user.js')}\n\n撤销授权：运行 Lanqiao: 撤销浏览器授权。\n`});await vscode.window.showTextDocument(doc,{preview:true});
  },
  import:()=>vscode.env.openExternal(vscode.Uri.parse('https://www.lanqiao.cn/problems/3008/learning/')),
  debug:()=>queue('debug'),submit:()=>queue('submit'),prepare:()=>queue('prepare'),open:openCurrent,
  localTest:async()=>{await current(true);await sendToCph(undefined,true);await vscode.commands.executeCommand('cph.runTestCases');},
  recent:async()=>{
   output.show(true);output.appendLine(recentText());
   const choice=await vscode.window.showInformationMessage('最近结果已显示在 Lanqiao OJ 输出面板。调试结果与正式提交记录独立标注。','打开官方记录');if(choice)await openCurrent();
  },
  revoke:async()=>{const next=randomBytes(32).toString('hex');await context.secrets.store('browser-token',next);bridge!.revoke(next);void vscode.window.showInformationMessage('全部浏览器授权已撤销，重新使用需要配对。');},
  actions:async()=>{
   const actions=[['打开题面（含操作按钮）','preview'],['切换解题语言（C / C++）','switchLanguage'],['发送至 CPH','sendToCph'],['本地测试（CPH）','localTest'],['OJ 在线调试（官方服务器）','debug'],['正式提交（需确认）','submit'],['查看最近提交','recent'],['打开网页','open'],['填入网页代码（手动提交）','prepare'],['配对浏览器 / 安装脚本','pair']];
   const picked=await vscode.window.showQuickPick(actions.map(([label,command])=>({label,command})),{ignoreFocusOut:true,title:'蓝桥 OJ'});if(picked)await vscode.commands.executeCommand(`lanqiao.${picked.command}`);
  }
 };
 for(const [name,run] of Object.entries(commands))context.subscriptions.push(vscode.commands.registerCommand(`lanqiao.${name}`,async()=>{try{return await run();}catch(e){const message=e instanceof Error?e.message:String(e);output.appendLine(message);output.show(true);void vscode.window.showErrorMessage(`Lanqiao：${message}`);}}));
 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,99);status.command='lanqiao.actions';
 const update=async()=>{const editorFile=vscode.window.activeTextEditor?.document.fileName,source=editorFile&&languageOfSource(editorFile)?editorFile:previews.activeSource;if(!source||!languageOfSource(source)){status.hide();return;}try{const p=validateProblem(JSON.parse(await readFile(path.join(path.dirname(source),'.lanqiao.json'),'utf8'))),c=bridge!.connection(p.id,languageOfSource(source));status.text=`$(${c.canRunOnline?'plug':'debug-disconnect'}) 蓝桥 #${p.id}`;status.tooltip=`${c.label}\n${c.detail}`;status.show();}catch{status.hide();}};
 void update();const timer=setInterval(()=>{void update();},2000);timer.unref();context.subscriptions.push(status,vscode.window.onDidChangeActiveTextEditor(()=>{void update();}),{dispose:()=>clearInterval(timer)});
}
function expandOptional(p:string){return p?expand(p):'';}
export async function deactivate(){await bridge?.close();bridge=undefined;}
