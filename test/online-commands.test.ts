import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {BridgeServer} from '../src/bridge';
import {importProblem} from '../src/storage';
import type {SourceFileNaming} from '../src/languages';
import {SubmissionStore} from '../src/submission-store';

// Only the VSCode UI boundary is replaced. Jobs, connection checks and duplicate protection use the real local bridge.
async function setup(language:'cpp'|'c'='cpp',naming:SourceFileNaming='problemId'){
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-online-commands-'));
 const template=path.join(root,'template.cpp');await writeFile(template,'// saved fixture\n');
 const p={version:1 as const,id:'3008',title:'命令测试',url:'https://www.lanqiao.cn/problems/3008/learning/',markdown:'# 3008 命令测试',tests:[{input:'1  2\n\n',output:'3\n'}]};
 const imported=await importProblem(root,template,p,undefined,language,undefined,{naming});
 let server!:BridgeServer,dirty=false,saveOK=true,buffer='',selection:string|undefined;
 const warnings:string[]=[],errors:string[]=[],output:string[]=[],picks:Array<{items:any[];options:any}>=[],values=new Map<string,unknown>(),commands=new Map<string,()=>Promise<unknown>>();
 const doc={fileName:imported.source,uri:{scheme:'file',fsPath:imported.source},get isDirty(){return dirty;},save:async()=>{if(!saveOK)return false;await writeFile(imported.source,buffer);dirty=false;return true;}};
 const disposable={dispose(){}};
 const vscode={TreeItem:class {constructor(readonly label:string){}},ThemeIcon:class {},TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},EventEmitter:class {event=()=>disposable;fire(){}dispose(){}},version:'test',ViewColumn:{One:1,Two:2},StatusBarAlignment:{Left:1},Uri:{file:(fsPath:string)=>({fsPath})},
  window:{createTreeView:()=>({...disposable}),activeTextEditor:{document:doc},createOutputChannel:()=>({...disposable,appendLine:(line:string)=>output.push(line),show(){}}),createStatusBarItem:()=>({...disposable,show(){},hide(){}}),onDidChangeActiveTextEditor:()=>disposable,
   showQuickPick:async(items:any[],options:any)=>{picks.push({items,options});return items.find(i=>i.label===selection);},
   showOpenDialog:async()=>{throw new Error('Unexpected input-file picker');},
   showWarningMessage:async(message:string)=>{warnings.push(message);},showInformationMessage:async()=>{},showErrorMessage:async(message:string)=>{errors.push(message);}},
  extensions:{getExtension:()=>undefined},workspace:{onDidChangeConfiguration:()=>disposable,registerTextDocumentContentProvider:()=>disposable,openTextDocument:async(file:string)=>{assert.equal(file,imported.source);return doc;},getConfiguration:(namespace:string)=>({get:(key:string,fallback:unknown)=>namespace==='lanqiao'?({port:0,root,template,defaultLanguage:language} as any)[key]??fallback:fallback})},
  commands:{registerCommand:(id:string,run:()=>Promise<unknown>)=>{commands.set(id,run);return disposable;},executeCommand:async()=>{}}
 };
 class Preview {activeSource=undefined;refreshConnections(){}dispose(){}}
 class LocalBridge extends BridgeServer {constructor(options:any){super(options);server=this;}}
 const built=await build({entryPoints:['src/extension.ts'],bundle:true,format:'cjs',platform:'node',write:false,external:['vscode'],plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/^\.\/(preview-panel|bridge)$/},args=>({path:args.path,external:true}));}}]});
 const module={exports:{} as any},require=createRequire(path.resolve('package.json'));
 vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='vscode'?vscode:id==='./preview-panel'?{ProblemPreviews:Preview}:id==='./bridge'?{BridgeServer:LocalBridge}:require(id),process,console,Buffer,URL,setInterval,clearInterval,setTimeout,clearTimeout,structuredClone});
 const state={get:(key:string,fallback:unknown)=>values.get(key)??fallback,update:async(key:string,value:unknown)=>{values.set(key,value);}};
 const subscriptions:Array<{dispose():void}>=[];
 await module.exports.activate({globalStorageUri:{fsPath:path.join(root,'extension-storage')},subscriptions,extension:{packageJSON:{version:'test'}},secrets:{get:async()=> 'local-test-token'},globalState:state,workspaceState:state});
 const post=async(route:string,body:unknown)=>{
  const response=await fetch(`http://127.0.0.1:${server.port}${route}`,{method:'POST',headers:{Authorization:'Bearer local-test-token','X-Lanqiao-Client':'userscript-v1','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);return response.json() as Promise<any>;
 };
 return {server,source:imported.source,warnings,errors,output,picks,
  snapshots: new SubmissionStore(path.join(root,'extension-storage','submissions')),
  report: (id:string,status:string) => post('/result',{id,worker:'test-browser',result:{phase:'done',status,submissionId:`official-${id}`}}),
  edit:(code:string,canSave=true)=>{buffer=code;dirty=true;saveOK=canSave;},
  choose:(label:string|undefined)=>{selection=label;},
  connect:async(problemId='3008',browserLanguage:string=language)=>post('/poll',{problemId,worker:'test-browser',protocol:3,editorReady:true,language:browserLanguage}),
  run:async(kind:'debug'|'submit')=>commands.get(`lanqiao.${kind}`)!(),
  close:async()=>{for(const sub of subscriptions)sub.dispose();await module.exports.deactivate();await rm(root,{recursive:true,force:true});}
 };
}

for(const language of ['cpp','c'] as const)test(`${language} 点击提交直接排队最新保存代码，连续操作不重复提交`,async()=>{
 const h=await setup(language);
 try{
  await h.connect();h.edit('// latest saved code\n');await h.run('submit');
  assert.equal(h.warnings.length,0);assert.equal(h.server.recent().length,1,h.errors.join('\n'));
  await h.run('submit');assert.equal(h.server.recent().length,1,h.errors.join('\n'));assert.ok(h.errors.length>0);
  const {job}=await h.connect();assert.equal(job.kind,'submit');assert.equal(job.language,language);assert.equal(job.problemId,'3008');assert.equal(job.code,'// latest saved code\n');
  assert.equal(h.server.recent().find(entry=>entry.id===job.id)?.sourceName,`3008.${language}`);
  assert.equal(await readFile(h.source,'utf8'),'// latest saved code\n');
 }finally{await h.close();}
});

test('旧 main.cpp 仍可走官方调试与提交命令，正式快照保留旧源码路径',async()=>{
 const h=await setup('cpp','main');
 try{
  await h.connect();h.choose('调试');await h.run('debug');
  const {job:debug}=await h.connect();
  assert.equal(h.server.recent().find(entry=>entry.id===debug.id)?.sourceName,'main.cpp');
  await h.report(debug.id,'AC');
  const id=await h.run('submit') as string;
  const {job}=await h.connect();
  assert.equal(h.server.recent().find(entry=>entry.id===job.id)?.sourceName,'main.cpp');
  await h.report(id,'AC');
  await h.snapshots.reload();
  assert.equal(h.snapshots.get(id)?.sourcePath,h.source);
 }finally{await h.close();}
});

test('正式任务与不可变代码关联，连续评测各写入对应快照，调试结果不进入历史',async()=>{
 const h=await setup();
 const key='lanqiao-oj:3008';
 try {
  await h.connect();h.choose('调试');await h.run('debug');
  const {job:debug}=await h.connect();await h.report(debug.id,'AC');
  await h.snapshots.reload();assert.deepEqual(h.snapshots.list(key),[]);
  for(const [status,code] of [['WA','// wrong\n'],['AC','// fixed\n'],['TLE','// slow\n']]) {
   h.edit(code);const id=await h.run('submit') as string;
   await writeFile(h.source,'// next local edit\n');
   const {job}=await h.connect();
   assert.ok(job,h.errors.join('\n'));assert.equal(job.id,id);assert.equal(job.code,code);
   await h.report(id,status);
   await h.snapshots.reload();
   assert.equal(h.snapshots.get(id)?.officialStatus,status);
   assert.equal(await h.snapshots.readCode(id),code);
  }
  assert.deepEqual(h.snapshots.list(key).map(s=>s.status),['time_limit_exceeded','accepted','wrong_answer']);
  assert.equal(h.snapshots.getReview(key)?.lastFailure?.status,'time_limit_exceeded');
  assert.equal(await readFile(h.source,'utf8'),'// next local edit\n');
 } finally {await h.close();}
});

test('保存失败或浏览器题号/语言不符时不创建提交任务',async()=>{
 for(const mode of ['save-failed','wrong-problem','wrong-language']){
  const h=await setup();
  try{
   await h.connect(mode==='wrong-problem'?'3009':'3008',mode==='wrong-language'?'c':'cpp');
   if(mode==='save-failed')h.edit('// cannot save',false);
   await h.run('submit');assert.equal(h.server.recent().length,0);assert.equal(h.warnings.length,0);assert.equal(h.errors.length,1);
   if(mode==='save-failed')assert.equal(await readFile(h.source,'utf8'),'// saved fixture\n');
  }finally{await h.close();}
 }
});

test('调试只提供样例和原生调试，选择、取消保持各自输入语义',async()=>{
 for(const label of ['样例 1','调试',undefined]){
  const h=await setup();
  try{
   await h.connect();h.choose(label);await h.run('debug');
   const items=h.picks[0].items;assert.deepEqual(Array.from(items,(i:any)=>i.label),['样例 1','调试']);
   assert.equal(items[1].description,undefined);
   if(label===undefined)assert.equal(h.server.recent().length,0);
   else {
    assert.equal(h.server.recent()[0].debugMode,label==='样例 1'?'input':'official');
    const {job}=await h.connect();assert.equal(job.kind,'debug');assert.equal(job.input,label==='样例 1'?'1  2\n\n':'');
   }
  }finally{await h.close();}
 }
});
