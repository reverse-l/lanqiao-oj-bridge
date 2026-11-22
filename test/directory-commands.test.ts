import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,mkdir,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle=build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
async function setup(outside=false,emptyLocal=false){
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-directory-command-')),root=path.join(dir,'Lanqiao'),problemDir=path.join(root,'3075-example');await mkdir(problemDir,{recursive:true});
 const source=path.join(problemDir,'main.cpp'),destination=path.join(dir,'export.json');
 const p={version:1,id:'3075',title:'示例',url:'https://www.lanqiao.cn/problems/3075/learning/',markdown:'题面',tests:[{input:'1\n',output:'2\n'}]};
 await writeFile(source,'PRIVATE SOLUTION');await writeFile(path.join(problemDir,'.lanqiao.json'),JSON.stringify(p));
 const uri=(fsPath:string)=>({fsPath,scheme:'file',toString:()=>`file:${fsPath}`}),folder={uri:uri(dir),name:'workspace',index:0};
 const original=emptyLocal?undefined:{'**/personal':true,'Lanqiao/*/.cph':false};let local:any=structuredClone(original),saveTarget:any=undefined;
 const updates:any[]=[],scopes:any[]=[],errors:string[]=[],messages:string[]=[],registered=new Map<string,()=>Promise<unknown>>(),state=new Map<string,unknown>();
 const doc={fileName:source,uri:uri(source),isDirty:false},disposable={dispose(){}};
 const vscode={TreeItem:class {constructor(readonly label:string){}},ThemeIcon:class {},TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},EventEmitter:class {event=()=>disposable;fire(){}dispose(){}},version:'test',ViewColumn:{One:1,Two:2},StatusBarAlignment:{Left:1},ConfigurationTarget:{WorkspaceFolder:3},Uri:{file:uri},
  workspace:{onDidChangeConfiguration:()=>disposable,registerTextDocumentContentProvider:()=>disposable,workspaceFolders:[folder],getWorkspaceFolder:()=>outside?undefined:folder,openTextDocument:async()=>doc,getConfiguration:(section:string,scope:any)=>{
   if(section==='files'){scopes.push(scope);return {inspect:()=>({globalValue:{'**/GLOBAL':true},workspaceValue:{'**/WORKSPACE':true},workspaceFolderValue:local}),update:async(key:string,value:unknown,target:number)=>{updates.push({key,value:structuredClone(value),target,scope});local=structuredClone(value);}};}
   return {get:(key:string,fallback:any)=>key==='root'?root:key==='port'?0:fallback};
  }},
  window:{createTreeView:()=>({...disposable}),activeTextEditor:{document:doc},createOutputChannel:()=>({...disposable,appendLine(){},show(){}}),registerWebviewPanelSerializer:()=>disposable,onDidChangeActiveTextEditor:()=>disposable,createStatusBarItem:()=>({...disposable,hide(){},show(){}}),showInformationMessage:async(s:string)=>{messages.push(s);},showWarningMessage:async()=>undefined,showErrorMessage:async(s:string)=>{errors.push(s);},showSaveDialog:async()=>saveTarget},
  commands:{registerCommand:(id:string,run:()=>Promise<unknown>)=>{registered.set(id,run);return disposable;}},extensions:{}
 };
 const module={exports:{} as any},require=createRequire(path.resolve('package.json'));
 vm.runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(name:string)=>name==='vscode'?vscode:require(name),process,Buffer,console,URL,setInterval,clearInterval,setTimeout,clearTimeout,structuredClone});
 const subscriptions:Array<{dispose():void}>=[];
 await module.exports.activate({globalStorageUri:{fsPath:path.join(dir,'extension-storage')},extension:{packageJSON:{version:'test'}},subscriptions,secrets:{get:async()=>'test-only-token'},globalState:{get:(_key:string,fallback:any)=>fallback,update:async()=>{}},workspaceState:{get:(key:string,fallback:any)=>state.get(key)??fallback,update:async(key:string,value:unknown)=>{state.set(key,value);}}});
 return {root,source,destination,folder,original,updates,scopes,errors,messages,getLocal:()=>local,registered,setSaveTarget:(value:any)=>{saveTarget=value;},uri,close:async()=>{for(const s of subscriptions)s.dispose();await module.exports.deactivate();}};
}
test('简洁目录显示只合并文件夹规则，重复启用后恢复仍保留原规则',async()=>{
 const w=await setup();try{
  assert.ok(w.registered.has('lanqiao.cleanExplorer'));assert.ok(w.registered.has('lanqiao.restoreExplorer'));
  await w.registered.get('lanqiao.cleanExplorer')!();await w.registered.get('lanqiao.cleanExplorer')!();
  assert.equal(w.getLocal()['Lanqiao/*/.cph'],true);assert.equal(w.getLocal()['**/personal'],true);assert.equal(w.getLocal()['**/GLOBAL'],undefined);assert.equal(w.getLocal()['**/WORKSPACE'],undefined);
  assert.ok(w.updates.every(u=>u.key==='exclude'&&u.target===3&&u.scope.fsPath===w.folder.uri.fsPath));
  await w.registered.get('lanqiao.restoreExplorer')!();assert.deepEqual(w.getLocal(),w.original);assert.deepEqual(w.errors,[]);
 }finally{await w.close();}
});
test('题目根目录不在工作区时不写配置，更不会退回全局设置',async()=>{
 const w=await setup(true);try{assert.ok(w.registered.has('lanqiao.cleanExplorer'));await w.registered.get('lanqiao.cleanExplorer')!();assert.equal(w.updates.length,0);assert.match(w.errors.join('\n'),/工作区/);}finally{await w.close();}
});
test('原本没有文件夹排除设置时，恢复会移除该设置而不固化全局规则',async()=>{
 const w=await setup(false,true);try{
  await w.registered.get('lanqiao.cleanExplorer')!();assert.equal(w.getLocal()['**/GLOBAL'],undefined);
  await w.registered.get('lanqiao.restoreExplorer')!();assert.equal(w.getLocal(),undefined);assert.equal(w.updates.at(-1).value,undefined);assert.deepEqual(w.errors,[]);
 }finally{await w.close();}
});
test('导出命令取消不写文件，主动保存后仅写入 Companion 协议',async()=>{
 const w=await setup();try{
  assert.ok(w.registered.has('lanqiao.exportCompanion'));const dir=path.dirname(w.destination),before=await readdir(dir);
  await w.registered.get('lanqiao.exportCompanion')!();assert.deepEqual(await readdir(dir),before);
  w.setSaveTarget(w.uri(w.destination));await w.registered.get('lanqiao.exportCompanion')!();
  const raw=await readFile(w.destination,'utf8'),data=JSON.parse(raw);assert.equal(data.srcPath,w.source);assert.equal(data.tests[0].input,'1\n');assert.doesNotMatch(raw,/PRIVATE SOLUTION/);assert.equal(await readFile(w.source,'utf8'),'PRIVATE SOLUTION');assert.deepEqual(w.errors,[]);
 }finally{await w.close();}
});
