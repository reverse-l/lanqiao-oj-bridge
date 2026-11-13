import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {importProblem} from '../src/storage';

test('切换语言写入默认设置，取消不改变设置，重新导入和 README 打开沿用该题语言',async()=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-language-command-')),template=path.join(root,'template.cpp');
 await writeFile(template,'// KEEP CPP');
 const problem={version:1 as const,id:'124',title:'密码脱落',url:'https://www.lanqiao.cn/problems/124/learning/',markdown:'# 124 密码脱落',tests:[]};
 const initial=await importProblem(root,template,problem),values=new Map<string,unknown>(),updates:unknown[][]=[],commands=new Map<string,()=>Promise<unknown>>(),shown:string[]=[];
 let defaultLanguage='cpp',pick:'c'|undefined='c',active:any,options:any;
 const doc=(file:string)=>({fileName:file,uri:{scheme:'file',fsPath:file},isDirty:false});active=doc(initial.source);
 const disposable={dispose(){}};
 const vscode={version:'test',ViewColumn:{One:1,Two:2},StatusBarAlignment:{Left:1},ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},Uri:{file:(fsPath:string)=>({fsPath})},
  window:{get activeTextEditor(){return {document:active};},createOutputChannel:()=>({...disposable,appendLine(){},show(){}}),createStatusBarItem:()=>({...disposable,show(){},hide(){}}),onDidChangeActiveTextEditor:()=>disposable,
   showQuickPick:async(items:any[])=>items.find(i=>i.value===pick),showTextDocument:async(document:any)=>{active=document;shown.push(document.fileName);},showWarningMessage:async()=>{},showErrorMessage:async(message:string)=>{throw new Error(message);}},
  extensions:{getExtension:()=>undefined},
  workspace:{openTextDocument:async(file:string)=>{await readFile(file);return doc(file);},getConfiguration:(namespace:string)=>({
   get:(key:string,fallback:unknown)=>namespace==='lanqiao'?({port:0,root,template,defaultLanguage} as any)[key]??fallback:fallback,
   inspect:()=>({}),update:async(key:string,value:string,target:number)=>{updates.push([namespace,key,value,target]);defaultLanguage=value;}})},
  commands:{registerCommand:(id:string,run:()=>Promise<unknown>)=>{commands.set(id,run);return disposable;},executeCommand:async()=>{}}
 };
 class Preview {activeSource=undefined;constructor(..._args:unknown[]){}async show(file:string){shown.push(file);}refreshConnections(){}update(){}dispose(){}}
 class Bridge {constructor(o:unknown){options=o;}async listen(){}async close(){}connection(){return {label:'等待网页连接',detail:'',canRunOnline:false};}}
 const result=await build({entryPoints:['src/extension.ts'],bundle:true,format:'cjs',platform:'node',write:false,external:['vscode'],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^\.\/(preview-panel|bridge)$/},args=>({path:args.path,external:true}));}}]});
 const module={exports:{} as any},require=createRequire(path.resolve('package.json'));
 vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='vscode'?vscode:id==='./preview-panel'?{ProblemPreviews:Preview}:id==='./bridge'?{BridgeServer:Bridge}:require(id),process,console,Buffer,URL,setInterval,clearInterval,setTimeout,clearTimeout});
 const state={get:(key:string,fallback:unknown)=>values.get(key)??fallback,update:async(key:string,value:unknown)=>{values.set(key,value);}};
 const subscriptions:Array<{dispose():void}>=[];
 try{
  await module.exports.activate({subscriptions,extension:{packageJSON:{version:'test'}},secrets:{get:async()=> 'test-only'},globalState:state,workspaceState:state});
  await commands.get('lanqiao.switchLanguage')!();
  assert.deepEqual(updates,[['lanqiao','defaultLanguage','c',1]]);
  assert.equal((values.get('problem.languages') as any)['124'],'c');
  assert.equal(await readFile(initial.source,'utf8'),'// KEEP CPP');
  assert.match(await readFile(path.join(initial.directory,'main.c'),'utf8'),/#include <stdio.h>/);
  pick=undefined;await commands.get('lanqiao.switchLanguage')!();assert.equal(updates.length,1);
  defaultLanguage='cpp';await options.onImport(problem);assert.equal(shown.at(-1),path.join(initial.directory,'main.c'));
  active=doc(path.join(initial.directory,'README.md'));await commands.get('lanqiao.preview')!();assert.equal(shown.at(-1),path.join(initial.directory,'main.c'));
 }finally{for(const sub of subscriptions)sub.dispose();await module.exports.deactivate();}
});
