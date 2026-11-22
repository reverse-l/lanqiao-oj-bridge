import * as vscode from 'vscode';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {BridgeServer,Job,JobKind} from './bridge';
import {importProblem,ensureCphProblem,restoreEmptyCphProblem,rejectSymlinks,exportCompanion,findProblemSource} from './storage';
import {Problem,validateProblem,type ProblemSource} from './problem';
import {formatResult,usesInputDebug} from './output';
import {ProblemPreviews} from './preview-panel';
import {samplesFromMarkdown} from './sample-markdown';
import {recoverHistory} from './result-card';
import {connectionState,type SourceScope} from './connection';
import {LanguageId,LANGUAGES,languageOfSource,requireLanguage,problemSourceName,type SourceFileNaming} from './languages';
import {traceCph} from './cph-diagnostics';
import {LanguagePreferences} from './language-preferences';
import {cleanPatterns,hideInternalFiles,restoreInternalFiles,ExcludeRules,PreviousRules} from './explorer-layout';
import {LocalProblemIndex} from './local-problems';
import {LocalProblemFileStorage} from './local-problem-storage';
import {registerLocalProblemView} from './local-problem-view';
import {ProblemEditorTabs} from './problem-editor-tabs';
import {SubmissionStore} from './submission-store';
import {registerSubmissionCommands} from './submission-view';

interface ManagedExcludes {previous:PreviousRules;hadValue:boolean}
type ManagedFolders=Record<string,ManagedExcludes>;

const expand=(p:string)=>p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):path.resolve(p);
let bridge:BridgeServer|undefined;
export async function activate(context:vscode.ExtensionContext){
 const output=vscode.window.createOutputChannel('Lanqiao OJ');context.subscriptions.push(output);
 const config=()=>vscode.workspace.getConfiguration('lanqiao');
 const diagnostic=(text:string)=>{if(config().get<boolean>('diagnostics',false))output.appendLine(text);};
 diagnostic(`Lanqiao OJ Bridge ${context.extension.packageJSON.version} · ${process.platform}/${process.arch} · VSCode ${vscode.version}`);
 const preferences=new LanguagePreferences(context.globalState,()=>requireLanguage(config().get<string>('defaultLanguage','cpp')),async language=>{
  const settings=config(),value=settings.inspect('defaultLanguage');
  const target=value?.workspaceFolderValue!==undefined?vscode.ConfigurationTarget.WorkspaceFolder:value?.workspaceValue!==undefined?vscode.ConfigurationTarget.Workspace:vscode.ConfigurationTarget.Global;
  await settings.update('defaultLanguage',language,target);
 });
 let token=await context.secrets.get('browser-token');if(!token){token=randomBytes(32).toString('hex');await context.secrets.store('browser-token',token);}
 let history=recoverHistory(context.globalState.get('history',[]),false);
 const indexStorage = new LocalProblemFileStorage(context.globalStorageUri.fsPath);
 const localProblems = new LocalProblemIndex(indexStorage);
 const reportIndexError = (error: unknown) => {
  output.appendLine(`本地题目记录保存失败：${String(error)}`);
  void vscode.window.showWarningMessage('本地题目记录保存失败，请查看 Lanqiao OJ 输出');
 };
 try {
  context.subscriptions.push(await indexStorage.watchChanges(
   () => { void localProblems.reload().catch(error => output.appendLine(`本地题目索引读取失败：${String(error)}`)); },
   error => output.appendLine(`本地题目索引监视失败：${String(error)}`),
  ));
 } catch (error) { output.appendLine(`本地题目索引监视失败：${String(error)}`); }
 try {
  await localProblems.reload();
  if (history.length) await localProblems.reconcile(history);
 } catch (error) { reportIndexError(error); }
 const chosenSources = new Map<string, ProblemSource>();
 // Resolve the VSCode-owned profile directory (for example, macOS exposes /tmp as an alias).
 const profileStorage = await realpath(context.globalStorageUri.fsPath).catch(() => context.globalStorageUri.fsPath);
 const submissions = new SubmissionStore(path.join(profileStorage, 'submissions'));
 const snapshotError = (error: unknown) => {
  output.appendLine(`提交快照处理失败：${String(error)}`);
  void vscode.window.showWarningMessage('提交快照处理失败，请查看 Lanqiao OJ 输出');
 };
 try {
  context.subscriptions.push(await submissions.watchChanges(snapshotError));
  await submissions.reload();
  for (const job of history) {
   if (job.kind === 'submit' && job.result && (job.state === 'finished' || job.state === 'expired') && submissions.get(job.id)) {
    await submissions.record(job);
   }
  }
 } catch (error) { snapshotError(error); }
 const scopeFor = (id: string): SourceScope | undefined => {
  const course = localProblems.get(`lanqiao-course:${id}`);
  const ordinary = localProblems.get(`lanqiao-oj:${id}`);
  if (!course) return ordinary?.sourceConfirmed ? {source: 'lanqiao-oj'} : undefined;
  if (ordinary && chosenSources.get(id) !== 'lanqiao-course') return {source: 'lanqiao-oj'};
  return {source: 'lanqiao-course', courseUrl: course.sourceUrl};
 };
 const problemTabs = new ProblemEditorTabs();
 registerLocalProblemView(context, localProblems, () => localProblems.importExisting(
  expand(config().get<string>('root')!), id => preferences.forProblem(id), history,
 ), (source, statement, track) => previews.show(source, statement, track), problem => {
  chosenSources.set(problem.id, problem.source);
  previews.refreshConnections();
 }, submissions, problemTabs);
 registerSubmissionCommands(context, localProblems, submissions, async () => {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const file = uri?.scheme === 'file' ? uri.fsPath : previews.activeSource;
  if (!file) return;
  const records = localProblems.list().filter(p => path.dirname(p.localFilePath) === path.dirname(file));
  return records.find(p => p.source === scopeFor(p.id)?.source)?.key ?? records[0]?.key;
 });
 const latest=(id:string,source?:string)=>history.filter(j=>j.problemId===id&&(!source||(j.language||'cpp')===languageOfSource(source)&&(!j.sourceName||j.sourceName===path.basename(source)))).at(-1);
 const templateFor=(language:LanguageId)=>language==='cpp'?expand(config().get<string>('template')!):expandOptional(config().get<string>('cTemplate',''));
 const sourceNaming=():SourceFileNaming=>config().get<string>('sourceFileNaming','problemId')==='main'?'main':'problemId';
 const indexedSource=(p:Problem)=>{
  const record=localProblems.get(`${p.courseUrl?'lanqiao-course':'lanqiao-oj'}:${p.id}`);
  return record?.localFilePath??(!p.source&&!p.courseUrl?localProblems.get(`lanqiao-course:${p.id}`)?.localFilePath:undefined);
 };
 const connectionFor=(id:string,source:string)=>bridge?.connection(id,languageOfSource(source)||'cpp',scopeFor(id))||connectionState(false,id,[],false);
 const previews:ProblemPreviews=new ProblemPreviews(context,async(action,source):Promise<string>=>{
  if(action==='switchLanguage'){return await switchLanguage(source)?'语言已保存':'';}
  if(action==='sendToCph'){await sendToCph(source);return '已发送至 CPH';}
  if(action==='localTest'){await sendToCph(source,true);await vscode.commands.executeCommand('cph.runTestCases');return '已开始本地测试';}
  if(action==='open'){const {p}=await current(false,source);await vscode.env.openExternal(vscode.Uri.parse(p.url));return '已打开这道题的蓝桥官方页面。';}
  if(action==='recent'){const {p}=await current(false,source);output.appendLine(recentText(p.id,source));output.show(true);return '最近评测已显示在输出面板';}
  if(action==='pair'){await vscode.commands.executeCommand('lanqiao.pair');return '已打开浏览器配对与脚本安装说明。';}
  if(action==='check'){const {p}=await current(false,source);bridge!.recheck(p.id);previews.refreshConnections();return '已重新检测，请保持本题网页打开。登录状态将以实际官方响应为准。';}
  if(action==='copyOutput'||action==='copyError'||action==='copyId'){
   const {p}=await current(false,source),r=latest(p.id,source)?.result;
   const value=action==='copyOutput'?r?.stdout:action==='copyError'?r?.stderr:r?.submissionId;
   if(value===undefined)throw new Error('平台没有提供该字段');await vscode.env.clipboard.writeText(value);return '已复制平台原始内容。';
  }
  const id=await queue(action,source);return id?'已进入本地队列，结果请查看 Lanqiao OJ 输出面板。':'操作已取消。';
 },connectionFor,(source, id) => {
  const records = localProblems.list().filter(problem => problem.id === id && path.dirname(problem.localFilePath) === path.dirname(source));
  return (records.find(problem => problem.source === scopeFor(id)?.source) ?? records[0])?.markdownFilePath;
 });context.subscriptions.push(previews);
 const persist=async (job:Job)=>{
  const {code,input,...safe}=job;
  history=history.filter(j=>j.id!==job.id);history.push(safe);history=history.slice(-50);void context.globalState.update('history',history);
  output.appendLine(`\n[${new Date().toLocaleString()}] ${job.kind==='debug'?'OJ 在线调试':job.kind==='submit'?'正式提交':'网页填入'} #${job.problemId} · ${LANGUAGES[job.language||'cpp'].label} · ${job.sourceName||'main.cpp'}：${job.result?.phase||job.state}`);
  if(job.result)output.appendLine(formatResult(job.result,usesInputDebug(job)));
  previews.refreshConnections();
  if(job.state==='finished'||job.state==='expired'){
   const label=job.kind==='debug'?'官方在线调试':'正式提交';
   if(job.result?.phase==='done')void vscode.window.showInformationMessage(`${label} #${job.problemId}：${usesInputDebug(job)?'执行已结束，请查看输出':job.result.status||job.result.message||'已完成'}`);
   else if(job.result?.phase!=='prepared')void vscode.window.showWarningMessage(job.result?.message||'未取得可靠结果，请查看官方网页');
  }
  const updates = [localProblems.recordResult(job).catch(reportIndexError)];
  if (job.kind === 'submit' && job.result) updates.push(submissions.record(safe).catch(snapshotError));
  await Promise.all(updates);
 };
 bridge=new BridgeServer({token,onUpdate:persist,onImport:async p=>{
  const root=expand(config().get<string>('root')!),language=preferences.forProblem(p.id),template=templateFor(language);
  const cph=expandOptional(vscode.workspace.getConfiguration('cph').get<string>('general.saveLocation',''));
  const result=await importProblem(root,template,p,cph,language,async file=>(await vscode.workspace.openTextDocument(file)).fileName,
   {naming:sourceNaming(),existingSource:indexedSource(p)});
  const indexed = await localProblems.upsert(p, result.source, history, result.markdownPath).catch(reportIndexError);
  if (indexed) chosenSources.set(p.id, indexed.source);
  previews.refreshConnections();
  await preferences.rememberProblem(p.id,language);
  const extension=vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper');if(extension)await extension.activate();
  const doc=await vscode.workspace.openTextDocument(result.source);
  const sourceOptions={viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false};
  const beside=vscode.workspace.getConfiguration('lanqiao',doc.uri).get('openMarkdownBesideSource',true);
  await problemTabs.open(indexed?.key??`${p.courseUrl?'lanqiao-course':'lanqiao-oj'}:${p.id}`,doc,{
   sourceOptions,
   showStatement:beside?track=>previews.show(result.source,indexed?.markdownFilePath,track):undefined,
   afterOpen:extension?async()=>{
    await vscode.commands.executeCommand('cph.judgeView.focus');
    // Return focus to the solution so CPH receives its editor-change event.
    await vscode.window.showTextDocument(doc,sourceOptions);
   }:undefined,
  });
  output.appendLine(`导入 #${p.id}：${result.source}；${result.samples} 组样例；${result.created?'从现有模板创建':'复用已有代码，全部已有文件保留'}`);
  if(!p.tests.length)void vscode.window.showWarningMessage(`题目 ${p.id} 未提取到样例，请查看题面并手动补充 CPH。`);
  return {created:result.created,id:p.id,samples:result.samples};
 }});
 const port=config().get<number>('port',27124);
 try{await bridge.listen(port);history=recoverHistory(context.globalState.get('history',[]),true);await context.globalState.update('history',history);diagnostic(`Bridge 已启动：127.0.0.1:${port}（与 CPH 27121 独立）`);}
 catch(e){output.appendLine(String(e));void vscode.window.showWarningMessage(`Lanqiao Bridge 无法监听 ${port}，可能另一个 VSCode 窗口已启动。请在那个窗口操作，或更改 Lanqiao 端口。`);}
 context.subscriptions.push({dispose:()=>{void bridge?.close();}});
 async function current(save=false,target?:string):Promise<{file:string;originalFile:string;p:Problem;code:string;sha:string;language:LanguageId}>{
  const editor=vscode.window.activeTextEditor;
  if (!target && editor?.document.uri.scheme === 'lanqiao-submission') {
   throw new Error('这是历史快照，请打开当前题目的源码后再操作');
  }
  const editorFile=editor?.document.uri.scheme==='file'?editor.document.fileName:undefined;
  const file=target||(editorFile&&languageOfSource(editorFile)?editorFile:previews.activeSource),language=file?languageOfSource(file):undefined;
  if(!file||!language)throw new Error('请先打开已导入题目目录内的 C / C++ 文件或蓝桥题面预览');
  await rejectSymlinks(file);await rejectSymlinks(path.join(path.dirname(file),'.lanqiao.json'));
  let p=validateProblem(JSON.parse(await readFile(path.join(path.dirname(file),'.lanqiao.json'),'utf8')));
  if(!p.tests.length){const recovered=samplesFromMarkdown(await readFile(path.join(path.dirname(file),'README.md'),'utf8'));if(recovered.length)p={...p,tests:recovered};}
  const document=await vscode.workspace.openTextDocument(file);
  if(save&&document.isDirty&&!await document.save())throw new Error('当前代码保存失败，已取消操作');
  const actualFile=document.fileName;await rejectSymlinks(actualFile);
  await preferences.rememberProblem(p.id,language);
  const code=await readFile(actualFile,'utf8');return {file:actualFile,originalFile:file,p,code,language,sha:createHash('sha256').update(code).digest('hex')};
 }
 async function sendToCph(source?:string,requireSamples=false):Promise<string>{
  if(config().get<boolean>('diagnostics',false))output.show(true);
  return traceCph(diagnostic,async step=>{
  const {file,originalFile,p}=await step('读取当前题目及源码路径',()=>current(requireSamples,source)),extension=vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper');
  if(originalFile!==file)diagnostic(`[CPH] 已按 VSCode 文档统一路径：${originalFile} → ${file}`);
  diagnostic(`[CPH] 题号 ${p.id}；源码 ${file}；题面样例 ${p.tests.length} 组`);
  if(!extension)throw new Error('未找到现有 CPH 扩展，请先启用 CPH');
  await step(`激活 CPH ${extension.packageJSON.version}（当前 ${extension.isActive?'已激活':'未激活'}）`,()=>extension.activate());
  const location=expandOptional(vscode.workspace.getConfiguration('cph',vscode.Uri.file(file)).get<string>('general.saveLocation',''));
  diagnostic(`[CPH] 保存目录 ${location||path.join(path.dirname(file),'.cph')}（${location?'设置值':'默认值'}）`);
  const result=await step('创建或复用样例记录',()=>ensureCphProblem(p,file,location,originalFile));
  diagnostic(`[CPH] 记录 ${result.path}；${result.created?'新建':'已有记录'}`);
  if(result.migratedFrom)diagnostic(`[CPH] 已复制旧路径测试，原记录保留：${result.migratedFrom}`);
  let tests=JSON.parse(await step('读取样例记录',()=>readFile(result.path,'utf8'))).tests,restored=false;
  if(Array.isArray(tests)&&!tests.length&&p.tests.length){
   const answer=await step('等待确认恢复空样例',()=>vscode.window.showWarningMessage(`这道题的旧 CPH 记录没有样例，已从保存的题面找到 ${p.tests.length} 组。\n文件：${result.path}\n将先保存 .before-samples.bak 备份，再恢复空样例；源码和题面不变。`,{modal:true},'备份并恢复样例'));
   if(answer==='备份并恢复样例'){restored=(await restoreEmptyCphProblem(p,file,location)).restored;tests=JSON.parse(await readFile(result.path,'utf8')).tests;}
  }
  diagnostic(`[CPH] 记录内样例 ${Array.isArray(tests)?tests.length:'格式异常'} 组`);
  if(requireSamples&&(!Array.isArray(tests)||!tests.length))throw new Error('当前 CPH 没有样例；请先恢复题面样例或手动添加。');
  const doc=await step('打开对应代码文件',()=>vscode.workspace.openTextDocument(file));await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preview:false});
  diagnostic(`[CPH] VSCode 实际文档路径 ${doc.fileName}；与记录路径${doc.fileName===file?'一致':'存在差异'}`);
  await step('显示 CPH 面板',()=>vscode.commands.executeCommand('cph.judgeView.focus'));await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false});
  return `已发送至 CPH：${p.id}《${p.title}》 · ${path.basename(file)}\n${restored?`已备份旧记录并恢复 ${p.tests.length} 组样例`:result.migratedFrom?`已按正确路径关联 ${tests.length} 组现有测试，旧记录保留`:result.created?`已加载 ${p.tests.length} 组题面样例`:tests?.length?'已复用现有测试，保留自定义样例':'当前没有样例，请恢复题面样例或手动添加'}。`;
  });
 }
 function recentText(id?:string,source?:string){const jobs=history.filter(j=>(!id||j.problemId===id)&&(!source||(j.language||'cpp')===languageOfSource(source)&&(!j.sourceName||j.sourceName===path.basename(source)))).slice(-10);return jobs.length?jobs.map(job=>`\n${job.kind==='debug'?'官方在线调试（自测）':job.kind==='submit'?'正式提交':'网页填入'} #${job.problemId} · ${LANGUAGES[job.language||'cpp'].label} · ${job.sourceName||'main.cpp'}\n${job.result?formatResult(job.result,usesInputDebug(job)):job.state}`).join('\n'):'本扩展还没有这道题的运行或提交记录，可在蓝桥原题页查看官方历史。';}
 async function openCurrent(){const {p}=await current();await vscode.env.openExternal(vscode.Uri.parse(p.url));}
 async function queue(kind:JobKind,target?:string){
  const selected=await current(true,target);
  const {file,p,language}=selected;let input:string|undefined,debugMode:'input'|'official'|undefined;
  const sourceScope=scopeFor(p.id);
  const connection=bridge!.connection(p.id,language,sourceScope);if(!connection.canRunOnline)throw new Error(`${connection.label}：${connection.detail}`);
  if(kind==='debug'){
   const choices=[...p.tests.map((s,i)=>({label:`样例 ${i+1}`,description:s.input.slice(0,70).replace(/\n/g,' '),value:s.input,mode:'input' as const})),{label:'调试',value:'',mode:'official' as const}];
   const pick=await vscode.window.showQuickPick(choices,{ignoreFocusOut:true,title:'调试'});if(!pick)return;
   debugMode=pick.mode;input=pick.value;
  }
  const {code,sha}=kind==='debug'?await current(true,file):selected;
  const request = {kind, problemId:p.id, code, input, debugMode, language, sourceName:path.basename(file), sourceScope};
  const job = kind === 'submit' ? await bridge!.enqueueSubmission(request, async pending => {
   const target = pending.sourceScope;
   const source = target?.source ?? (p.courseUrl ? 'lanqiao-course' : 'lanqiao-oj');
   const key = `${source}:${p.id}`;
   if (!localProblems.get(key)) {
    const problem = target ? {...p, source: target.source, courseUrl: target.courseUrl} : p;
    await localProblems.upsert(problem, file, history);
   }
   try { await submissions.create(pending, key, file, config().get<number>('snapshotRetention', 20)); }
   catch (error) { throw new Error(`无法保存提交快照，代码未发送。${error instanceof Error ? error.message : String(error)}`); }
  }) : bridge!.enqueue(request);
  output.appendLine(`\n${kind==='debug'?'OJ 在线调试':kind==='submit'?'正式提交':'网页填入'} #${p.id} 已进入本地队列；${file}\nSHA-256 ${sha}\n请保持已配对的对应题目网页打开。`);output.show(true);
  // 避免在未配对时自动把包含代码的任务交给新网页；只打开无令牌的题目 URL。
  if(Date.now()-bridge!.lastBrowserSeen>10_000){void vscode.window.showInformationMessage('请在对应蓝桥网页安装脚本并配对，然后保持页面打开。');await vscode.env.openExternal(vscode.Uri.parse(p.url));}
  return job.id;
 }
 async function switchLanguage(source?:string){
  const {file,p,language}=await current(false,source);
  const folder=path.dirname(file),naming=sourceNaming();
  const choices=await Promise.all((['cpp','c'] as const).map(async value=>{
   const existingSource=value===language?file:await findProblemSource(folder,p.id,value,indexedSource(p));
   const name=existingSource?path.basename(existingSource):problemSourceName(p.id,value,naming);
   return {label:LANGUAGES[value].label,description:name+(value===language?'（当前）':''),value,existingSource};
  }));
  const pick=await vscode.window.showQuickPick(choices,{title:'选择本题解题语言；已有文件保持原样',ignoreFocusOut:true});if(!pick)return;
  const location=expandOptional(vscode.workspace.getConfiguration('cph',vscode.Uri.file(file)).get<string>('general.saveLocation',''));
  const result=await importProblem(path.dirname(folder),templateFor(pick.value),p,location,pick.value,
   async source=>(await vscode.workspace.openTextDocument(source)).fileName,{naming,existingSource:pick.existingSource??file});
  await preferences.choose(p.id,pick.value);
  const doc=await vscode.workspace.openTextDocument(result.source);await previews.show(result.source);await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.One,preview:false});
  if(vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper'))await sendToCph(result.source);
  return true;
 }
 const explorerStateKey='explorer.exclude.v1';
 function managedFolders():ManagedFolders {
  const value=context.workspaceState.get<ManagedFolders>(explorerStateKey,{});
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 }
 function folderExcludes(settings:vscode.WorkspaceConfiguration){
  const value=settings.inspect<ExcludeRules>('exclude')?.workspaceFolderValue;
  if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('当前工作区 files.exclude 格式异常，未修改');
  return {rules:value||{},hadValue:value!==undefined};
 }
 async function cleanExplorer(){
  const root=expand(config().get<string>('root')!),folder=vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  if(!folder)throw new Error('题目目录不在当前工作区内；请先将 Lanqiao Root 目录添加到工作区，再启用简洁目录显示。未修改全局设置。');
  const patterns=cleanPatterns(path.relative(folder.uri.fsPath,root)),settings=vscode.workspace.getConfiguration('files',folder.uri),existing=folderExcludes(settings);
  const folders=managedFolders(),key=folder.uri.toString(),previous=folders[key];
  const result=hideInternalFiles(existing.rules,patterns,previous?.previous||{});
  await context.workspaceState.update(explorerStateKey,{...folders,[key]:{previous:result.previous,hadValue:previous?.hadValue??existing.hadValue}});
  try{await settings.update('exclude',result.next,vscode.ConfigurationTarget.WorkspaceFolder);}
  catch(error){await context.workspaceState.update(explorerStateKey,folders);throw error;}
  void vscode.window.showInformationMessage('已启用蓝桥简洁目录显示；文件保留，可运行「Lanqiao: 恢复目录显示设置」撤销。');
 }
 async function restoreExplorer(){
  const folders=managedFolders(),remaining={...folders};let restored=0;
  for(const folder of vscode.workspace.workspaceFolders||[]){
   const key=folder.uri.toString(),saved=folders[key];if(!saved)continue;
   const settings=vscode.workspace.getConfiguration('files',folder.uri),current=folderExcludes(settings);
   const next=restoreInternalFiles(current.rules,saved.previous);
   await settings.update('exclude',!saved.hadValue&&!Object.keys(next).length?undefined:next,vscode.ConfigurationTarget.WorkspaceFolder);
   delete remaining[key];await context.workspaceState.update(explorerStateKey,remaining);restored++;
  }
  void vscode.window.showInformationMessage(restored?'已恢复原目录显示设置，保留你之后修改的规则。':'当前工作区没有需要恢复的蓝桥显示设置。');
 }
 const commands:Record<string,()=>unknown>={
  preview:async()=>{
   const uri=vscode.window.activeTextEditor?.document.uri;let source=uri?.scheme==='file'&&languageOfSource(uri.fsPath)?uri.fsPath:previews.activeSource;
   if(!source&&uri?.scheme==='file'&&path.basename(uri.fsPath)==='README.md'){
    const metadata=path.join(path.dirname(uri.fsPath),'.lanqiao.json');await rejectSymlinks(metadata);
    const problem=validateProblem(JSON.parse(await readFile(metadata,'utf8'))),preferred=preferences.forProblem(problem.id);
    const choices=[];for(const language of ['cpp','c'] as const){
     const file=await findProblemSource(path.dirname(uri.fsPath),problem.id,language,indexedSource(problem));
     if(file)choices.push({label:LANGUAGES[language].label,description:path.basename(file),file});
    }
    source=choices.find(choice=>languageOfSource(choice.file)===preferred)?.file||(choices.length===1?choices[0].file:(await vscode.window.showQuickPick(choices,{title:'选择题面绑定的解法'}))?.file);
   }
   if(!source)throw new Error('请先打开已导入题目的 C / C++ 文件或 README.md');const selected=await current(false,source);
   if (!await previews.show(selected.file)) throw new Error('找不到题面文件，可从本地题目列表重新关联');
  },
  switchLanguage:()=>switchLanguage(),
  cleanExplorer,restoreExplorer,
  exportCompanion:async()=>{
   const {p,file,language}=await current();
   const target=await vscode.window.showSaveDialog({title:'导出 Companion JSON（题面样例，不含解题代码）',defaultUri:vscode.Uri.file(path.join(path.dirname(file),`companion.${language}.json`)),filters:{JSON:['json']},saveLabel:'导出'});
   if(!target)return;
   await exportCompanion(p,file,target.fsPath);void vscode.window.showInformationMessage(`已导出 Companion JSON：${target.fsPath}`);
  },
  sendToCph:async()=>{const message=await sendToCph();void vscode.window.showInformationMessage('已发送至 CPH');return message;},
  pair:async()=>{
   const pairing=bridge!.createPairing();
   output.appendLine('配对说明：令牌只存 SecretStorage / GM 隔离存储；配对码 5 分钟有效且只用一次。');
   const doc=await vscode.workspace.openTextDocument({language:'markdown',content:`# Lanqiao OJ Bridge 浏览器配对\n\n1. 在浏览器启用脚本猫（ScriptCat），从 https://scriptcat.org/zh-CN/script-show-page/9067 安装 Lanqiao OJ Bridge 用户脚本。\n2. 打开蓝桥题目页，展开网页边缘的拱桥浮球，再点「配对」。\n3. 输入下方一次性配对码（5 分钟有效）。\n\n端口：${port}\n\n配对码：${pairing.code}\n\n离线脚本文件：${context.asAbsolutePath('dist/lanqiao-bridge.user.js')}\n\n撤销授权：运行 Lanqiao: 撤销浏览器授权。\n`});await vscode.window.showTextDocument(doc,{preview:true});
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
   const actions=[['打开题面','preview'],['切换语言','switchLanguage'],['发送至 CPH','sendToCph'],['本地测试','localTest'],['调试','debug'],['提交','submit'],['查看最近提交','recent'],['打开网页','open'],['填入网页代码','prepare'],['配对','pair'],['导出 Companion JSON','exportCompanion'],['简洁目录显示','cleanExplorer'],['恢复目录显示设置','restoreExplorer']];
   const picked=await vscode.window.showQuickPick(actions.map(([label,command])=>({label,command})),{ignoreFocusOut:true,title:'蓝桥 OJ'});if(picked)await vscode.commands.executeCommand(`lanqiao.${picked.command}`);
  }
 };
 for(const [name,run] of Object.entries(commands))context.subscriptions.push(vscode.commands.registerCommand(`lanqiao.${name}`,async()=>{try{return await run();}catch(e){const message=e instanceof Error?e.message:String(e);output.appendLine(message);output.show(true);void vscode.window.showErrorMessage(`Lanqiao：${message}`);}}));
 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,99);status.command='lanqiao.actions';
 const update=async()=>{const editorFile=vscode.window.activeTextEditor?.document.fileName,source=editorFile&&languageOfSource(editorFile)?editorFile:previews.activeSource;if(!source||!languageOfSource(source)){status.hide();return;}try{const p=validateProblem(JSON.parse(await readFile(path.join(path.dirname(source),'.lanqiao.json'),'utf8'))),c=connectionFor(p.id,source);status.text=`$(${c.canRunOnline?'plug':'debug-disconnect'}) 蓝桥 #${p.id}`;status.tooltip=`${c.label}\n${c.detail}`;status.show();}catch{status.hide();}};
 void update();const timer=setInterval(()=>{void update();},2000);timer.unref();context.subscriptions.push(status,vscode.window.onDidChangeActiveTextEditor(()=>{void update();}),{dispose:()=>clearInterval(timer)});
}
function expandOptional(p:string){return p?expand(p):'';}
export async function deactivate(){await bridge?.close();bridge=undefined;}
