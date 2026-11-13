import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,mkdir,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild';
import {cphFile} from '../src/storage';

for(const diagnostics of [false,true])for(const failure of [false,true])test(`CPH ${diagnostics?'诊断':'正常'}模式${failure?'仍显示真实错误':'正确关联样例且不打扰编辑'}`,async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-command-')),source=path.join(dir,'main.cpp');
 await mkdir(path.join(dir,'canonical'));const actualSource=path.join(dir,'canonical','main.cpp');
 const p={version:1,id:'3008',title:'特殊的三角形',url:'https://www.lanqiao.cn/problems/3008/learning/',markdown:'题目',tests:[{input:'1\n30 50\n',output:'1\n'}]};
 await writeFile(source,'// solution must remain unchanged');await writeFile(path.join(dir,'.lanqiao.json'),JSON.stringify(p));
 await link(source,actualSource);
 const logs:string[]=[],notifications:string[]=[],errors:string[]=[],commands=new Map<string,()=>Promise<unknown>>(),focused:string[]=[];let outputShows=0;
 const disposable={dispose(){}};
 const doc={fileName:actualSource,uri:{scheme:'file',fsPath:actualSource},isDirty:false};
 const vscode={version:'test',ViewColumn:{One:1,Two:2},StatusBarAlignment:{Left:1},
  window:{createOutputChannel:()=>({appendLine:(s:string)=>logs.push(s),show(){outputShows++;},dispose(){}}),
   activeTextEditor:{document:{...doc,fileName:source,uri:{scheme:'file',fsPath:source}}},registerWebviewPanelSerializer:()=>disposable,
   createStatusBarItem:()=>({...disposable,hide(){},show(){}}),onDidChangeActiveTextEditor:()=>disposable,
   showTextDocument:async()=>({document:doc}),showInformationMessage:async(s:string)=>{notifications.push(s);},showWarningMessage:async(s:string)=>{logs.push(s);},showErrorMessage:async(s:string)=>{errors.push(s);}},
  workspace:{getConfiguration:()=>({get:(key:string,fallback:unknown)=>key==='port'?0:key==='diagnostics'?diagnostics:fallback}),openTextDocument:async()=>doc},
  extensions:{getExtension:()=>({packageJSON:{version:'2026.10.1792170155'},isActive:true,activate:async()=>{if(failure)throw new Error('CPH activation failed');}})},
  Uri:{file:(fsPath:string)=>({fsPath})},
  commands:{registerCommand:(id:string,run:()=>Promise<unknown>)=>{commands.set(id,run);return disposable;},executeCommand:async(id:string)=>{focused.push(id);}}
 };
 const bundle=await build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
 const module={exports:{} as any},require=createRequire(path.resolve('package.json'));
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='vscode'?vscode:require(id),process,console,Buffer,URL,setInterval,clearInterval,setTimeout,clearTimeout});
 const subscriptions:Array<{dispose():void}>=[];
 try{
  await module.exports.activate({extension:{packageJSON:{version:'diagnostic'}},subscriptions,secrets:{get:async()=> 'test-only-token'},globalState:{get:()=>[],update:async()=>{}},workspaceState:{get:()=>[]}});
  await commands.get('lanqiao.sendToCph')!();
  if(failure){assert.match(errors.join('\n'),/CPH activation failed/);assert.ok(outputShows>0);assert.equal(notifications.length,0);return;}
  const saved=JSON.parse(await readFile(cphFile(actualSource),'utf8'));
  assert.equal(saved.srcPath,actualSource);
  assert.deepEqual(saved.tests.map((t:any)=>({input:t.input,output:t.output})),p.tests);
  if(diagnostics){assert.match(logs.join('\n'),/\[CPH\] 开始发送/);assert.match(logs.join('\n'),/记录内样例 1 组/);assert.ok(outputShows>0);}
  else{assert.doesNotMatch(logs.join('\n'),/\[CPH\]|实际文档路径|VSCode test/);assert.equal(outputShows,0);}
  assert.match(notifications.join('\n'),/已发送至 CPH/);
  assert.ok(focused.includes('cph.judgeView.focus'));
  assert.equal(await readFile(source,'utf8'),'// solution must remain unchanged');
 }finally{for(const sub of subscriptions)sub.dispose();await module.exports.deactivate();}
});
