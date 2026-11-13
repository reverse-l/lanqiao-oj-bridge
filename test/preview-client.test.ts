import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installPreviewClient} from '../src/webview/client';
test('断线时仍可本地测试；在线最终结果不被排队回执覆盖',()=>{
 const {window,document}=parseHTML('<html><body><div id="connection"></div><nav id="controls"><button data-action="localTest">local</button><button data-action="debug">debug</button></nav><div id="status"></div><div id="result"></div></body></html>');
 const sent:unknown[]=[];let state:any;
 Object.assign(window,{scrollY:0,scrollTo:()=>{},requestAnimationFrame:(cb:()=>void)=>cb()});
 installPreviewClient(window as any,{postMessage:m=>sent.push(m),setState:s=>state=s},{version:1,source:'/tmp/main.cpp',scrollY:0});
 const receive=(data:unknown)=>{const event=new window.Event('message');Object.assign(event,{data});window.dispatchEvent(event);};
 receive({type:'connection',connection:{kind:'waiting',label:'等待',detail:'打开网页',canRunOnline:false}});
 assert.equal(Boolean(document.querySelector('#connection small')),false);
 assert.equal(document.querySelector('[data-action="pair"]')?.textContent,'配对');
 assert.equal(document.querySelector('#connection strong')?.getAttribute('title'),'打开网页');
 assert.equal((document.querySelector('[data-action="debug"]') as any).disabled,true);
 (document.querySelector('[data-action="localTest"]') as any).click();assert.deepEqual(sent.at(-1),{action:'localTest'});
 receive({type:'jobResult',job:{id:'x',kind:'debug',problemId:'3008',created:1,state:'finished',result:{phase:'done',status:'CE',stderr:'bad'}}});
 receive({type:'actionResult',text:'已排队'});
 assert.match(document.querySelector('#result')!.textContent!,/bad/);assert.equal((document.querySelector('[data-action="debug"]') as any).disabled,true);
 Object.assign(window,{scrollY:400});window.dispatchEvent(new window.Event('scroll'));
 assert.equal(state.scrollY,400);assert.equal(state.source,'/tmp/main.cpp');
});
test('样例复制只向宿主传块序号，离线可用',()=>{
 const {window,document}=parseHTML('<html><body><button data-copy-block="1">复制</button><div id="status"></div></body></html>');
 const sent:unknown[]=[];Object.assign(window,{scrollTo:()=>{},requestAnimationFrame:(cb:()=>void)=>cb()});
 installPreviewClient(window as any,{postMessage:m=>sent.push(m),setState:()=>{}},{version:1,source:'/tmp/main.cpp',scrollY:0});
 (document.querySelector('button') as any).click();assert.deepEqual(sent.at(-1),{action:'copyBlock',index:1});
});
test('每次 HTML 重建先请求快照，重放最终结果与连接后恢复按钮',()=>{
 const {window,document}=parseHTML('<html><body><div id="connection"></div><nav id="controls"><button data-action="debug" disabled>debug</button></nav><div id="status"></div><div id="result">等待网页接收</div></body></html>');
 const sent:unknown[]=[];Object.assign(window,{scrollTo:()=>{},requestAnimationFrame:(cb:()=>void)=>cb()});
 installPreviewClient(window as any,{postMessage:m=>sent.push(m),setState:()=>{}},{version:1,source:'/tmp/main.cpp',scrollY:0});
 assert.deepEqual(sent.at(-1),{type:'ready'});
 const event=new window.Event('message');Object.assign(event,{data:{type:'snapshot',connection:{label:'已连接',detail:'登录未知',canRunOnline:true},job:{id:'x',kind:'submit',problemId:'3008',created:1,state:'finished',result:{phase:'done',status:'AC'}},pending:false,text:''}});window.dispatchEvent(event);
 assert.match(document.querySelector('#result')!.textContent!,/AC/);assert.equal((document.querySelector('[data-action="debug"]') as any).disabled,false);
});
test('用户指针滚动后图片 load 不覆盖新阅读位置',()=>{
 const {window}=parseHTML('<html><body><div id="connection"></div><div id="controls"></div><div id="status"></div><div id="result"></div></body></html>');
 const positions:number[]=[];Object.assign(window,{scrollTo:(_x:number,y:number)=>positions.push(y),requestAnimationFrame:(cb:()=>void)=>cb()});
 installPreviewClient(window as any,{postMessage:()=>{},setState:()=>{}},{version:1,source:'/tmp/main.cpp',scrollY:100});
 window.dispatchEvent(new window.Event('pointerdown'));window.dispatchEvent(new window.Event('load'));
 assert.deepEqual(positions,[100]);
});
test('成功反馈短暂显示，错误提示保留，下一次操作不会被旧计时器清除',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {window,document}=parseHTML('<html><body><button data-action="localTest">测试</button><div id="status"></div></body></html>');
 Object.assign(window,{scrollTo:()=>{},requestAnimationFrame:(cb:()=>void)=>cb()});
 installPreviewClient(window as any,{postMessage:()=>{},setState:()=>{}},{version:1,source:'/tmp/main.cpp',scrollY:0});
 const receive=(text:string,level:string)=>{const e=new window.Event('message');Object.assign(e,{data:{type:'actionResult',text,level}});window.dispatchEvent(e);};
 receive('已发送至 CPH','success');t.mock.timers.tick(3501);assert.equal(document.querySelector('#status')?.textContent,'');
 receive('登录失效','error');t.mock.timers.tick(3501);assert.equal(document.querySelector('#status')?.textContent,'登录失效');
 receive('已复制','success');document.querySelector('button')!.click();t.mock.timers.tick(3501);assert.equal(document.querySelector('#status')?.textContent,'正在处理…');
});
