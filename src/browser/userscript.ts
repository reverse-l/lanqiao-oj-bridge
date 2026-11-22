import {parseProblem} from '../problem';
import {executeOfficial,environment,editorReadiness,OfficialError} from './platform';
import type {PlatformResult} from '../report';
import {resolvePageContext} from './page-context';
import {mountDock,BridgeDock} from './dock';
declare const unsafeWindow:Window;
declare function GM_getValue<T>(key:string,fallback:T):T;
declare function GM_setValue(key:string,value:unknown):void;
declare function GM_registerMenuCommand(name:string,callback:()=>void):void;
declare function GM_xmlhttpRequest(options:{method:string;url:string;headers:Record<string,string>;data:string;timeout:number;onload:(r:{status:number;responseText:string})=>void;onerror:()=>void;ontimeout:()=>void}):void;

const worker=crypto.randomUUID();let running=false;let connection='未配对';let nextPoll=0;let actionUntil=0;
let dock:BridgeDock|undefined,activeKey='';
function request(route:string,data:unknown,paired=true):Promise<any>{
 const port=GM_getValue('port',27124);const token=GM_getValue('token','');
 if(paired&&!token)return Promise.reject(new Error('请先在 VSCode 执行「Lanqiao: 配对」'));
 return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:`http://127.0.0.1:${port}${route}`,headers:{'Content-Type':'application/json','X-Lanqiao-Client':'userscript-v1',...(paired?{Authorization:`Bearer ${token}`}:{})},data:JSON.stringify(data),timeout:15_000,
  onload:r=>{try{const b=JSON.parse(r.responseText);if(r.status!==200){if(r.status===401)connection='授权失效，请重新配对';reject(new Error(b.error||`HTTP ${r.status}`));}else resolve(b);}catch(e){reject(e);}},
  onerror:()=>reject(new Error('连接 VSCode 失败，请确认扩展已启动、端口正确（默认 27124），Tampermonkey 允许本地连接。')),
  ontimeout:()=>reject(new Error('连接 VSCode 超时'))}));
}
function status(message:string){if(message==='已连接 VSCode'&&Date.now()<actionUntil)return;if(message!=='已连接 VSCode')actionUntil=Date.now()+10_000;connection=message;dock?.setStatus(message);}
async function pair(){
 const input=prompt('输入 VSCode「Lanqiao: 配对」显示的一次性配对码（不是蓝桥密码或 Cookie）：');
 if(!input)return;try{const result=await request('/pair',{code:input.trim()},false);GM_setValue('token',result.token);status('已配对');}catch(e){alert(String(e));}
}
async function poll(){
 if(running||Date.now()<nextPoll||!GM_getValue('token',''))return;
 const context=resolvePageContext(unsafeWindow);if(!context)return;const id=context.id;
 running=true;
 try{
  const problemSource = context.kind === 'course' ? 'lanqiao-course' : 'lanqiao-oj';
  const {job}=await request('/poll',{problemId:id,worker,protocol:3,problemSource,courseUrl:context.courseUrl,...editorReadiness(unsafeWindow)});status('已连接 VSCode');
  if(job){
   status(job.kind==='debug'?'官方在线调试中…':job.kind==='submit'?'官方提交中…':'填入代码…');
   let chain=Promise.resolve();
   const send=(result:PlatformResult)=>{chain=chain.then(()=>request('/result',{id:job.id,worker,result}));};
   try{if(resolvePageContext(unsafeWindow)?.key!==context.key)throw new Error('页面单元已切换，任务停止，请在目标题目重新操作');const result=await executeOfficial(unsafeWindow,job,send,code=>GM_setValue(`backup-${id}`,code));await chain;await request('/result',{id:job.id,worker,result});status(result.phase==='done'?`官方结果：${result.status||result.message||'完成'}`:result.message||result.phase);}
   catch(e){await chain.catch(()=>{});await request('/result',{id:job.id,worker,result:{phase:'error',message:String(e),...(e instanceof OfficialError&&e.errorCode?{errorCode:e.errorCode}:{})}}).catch(()=>{});status(String(e));}
  }
 }catch(e){status(String(e));nextPoll=Date.now()+10_000;}
 finally{running=false;}
}
function mount(){
 const context=resolvePageContext(unsafeWindow);
 if(!context||!document.querySelector('.course-name')||!document.querySelector('.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4')){dock?.dispose();dock=undefined;activeKey='';return;}
 if(activeKey!==context.key){activeKey=context.key;actionUntil=0;status(GM_getValue('token','')?'等待连接 VSCode':'未配对');}
 if(dock)return;
 dock=mountDock(window,{read:()=>GM_getValue('dock-position-v1',null),write:value=>GM_setValue('dock-position-v1',value),status:connection,pair,importProblem:async()=>{
  try {
   const current = resolvePageContext(unsafeWindow);
   if (!current) throw new Error('当前单元尚未加载为 OJ 题目，请稍后重试');
   status('正在提取题面…');
   const p = parseProblem(document, current.url);
   if (resolvePageContext(unsafeWindow)?.key !== current.key) throw new Error('提取期间页面已切换，请重试');
   const source = current.kind === 'course' ? 'lanqiao-course' : 'lanqiao-oj';
   const r = await request('/import', {...p, source, courseUrl: current.courseUrl});
   status(`${r.created?'已创建':'已复用'} ${p.id}，样例 ${p.tests.length} 组；已有文件保留`);
  } catch (e) { status(String(e)); }
 }});
}
GM_registerMenuCommand('配对 VSCode',()=>{void pair();});
GM_registerMenuCommand('设置本地端口',()=>{const p=Number(prompt('VSCode 扩展端口（默认 27124；不能使用 CPH 27121）',String(GM_getValue('port',27124))));if(Number.isInteger(p)&&p>=1024&&p<=65535&&p!==27121){GM_setValue('port',p);status('端口已更新');}});
GM_registerMenuCommand('恢复上次网页代码',()=>{try{const context=resolvePageContext(unsafeWindow);if(!context)throw new Error('当前 OJ 题目尚未就绪');const code=GM_getValue<string|null>(`backup-${context.id}`,null);if(code!==null&&confirm('恢复扩展操作前的网页代码？'))environment(unsafeWindow).monacoEditor.setValue(code);}catch(e){alert(String(e));}});
GM_registerMenuCommand('重置浮球位置',()=>{if(dock)dock.reset();else GM_setValue('dock-position-v1',{side:'right',y:.5,expanded:false});});
GM_registerMenuCommand('清除本地授权',()=>{GM_setValue('token','');status('授权已清除');});
setInterval(()=>{mount();void poll();},1500);mount();
