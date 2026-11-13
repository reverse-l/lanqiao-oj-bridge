import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {BridgeServer} from '../src/bridge';
const origin='https://www.lanqiao.cn';
async function setup(){
 const bridge=new BridgeServer({token:randomBytes(32).toString('hex'),onImport:async p=>({id:p.id}),jobTimeoutMs:100});
 await bridge.listen(0);const base=`http://127.0.0.1:${bridge.port}`;
 const call=async(route:string,data:unknown={},headers:Record<string,string>={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Lanqiao-Client':'userscript-v1',Origin:origin,...headers},body:JSON.stringify(data)});
 const pair=bridge.createPairing();const response=await call('/pair',{code:pair.code});const {token}=await response.json() as {token:string};
 const auth={Authorization:`Bearer ${token}`};
 await call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},auth);
 return {bridge,base,call,auth,code:pair.code};
}
test('未授权、错误来源、DNS 重绑定和重复配对不能取得任务',async()=>{
 const s=await setup();try{
 assert.equal((await s.call('/poll',{problemId:'3008',worker:'a'})).status,401);
 assert.equal((await s.call('/poll',{problemId:'3008',worker:'a'},{...s.auth,Origin:'https://evil.example'})).status,403);
 const rebound=await new Promise<number>((resolve,reject)=>{const req=http.request(s.base+'/poll',{method:'POST',headers:{Host:'evil.example','X-Lanqiao-Client':'userscript-v1','Content-Type':'application/json',...s.auth}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');});
 assert.equal(rebound,403);
 assert.equal((await s.call('/pair',{code:s.code})).status,401);
 assert.equal((await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth)).status,200);
 }finally{await s.bridge.close();}
});
test('任务限定题号和单一接收者；结果必须匹配，不因 HTTP 200 判 AC',async()=>{
 const s=await setup();try{
 const job=s.bridge.enqueue({kind:'debug',problemId:'3008',code:'int main(){}',input:'1\n'});
 assert.equal((await (await s.call('/poll',{problemId:'3009',worker:'a'},s.auth)).json()).job,null);
 const take=await (await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth)).json();assert.equal(take.job.id,job.id);
 assert.equal((await (await s.call('/poll',{problemId:'3008',worker:'b'},s.auth)).json()).job,null);
 assert.equal((await s.call('/result',{id:job.id,worker:'b',result:{phase:'done',status:'AC'}},s.auth)).status,409);
 assert.equal((await s.call('/result',{id:job.id,worker:'a',result:{phase:'accepted',submissionId:'real-id'}},s.auth)).status,200);
 assert.equal(job.result?.phase,'accepted');assert.equal(job.result?.status,undefined);
 assert.equal((await s.call('/result',{id:job.id,worker:'a',result:{phase:'done',status:'CE',stderr:'compiler failed'}},s.auth)).status,200);
 assert.equal(job.result?.status,'CE');assert.equal(job.state,'finished');assert.equal(job.code,undefined);
 }finally{await s.bridge.close();}
});
test('超时删除代码且不重发，浏览器断开不自动再次提交',async()=>{
 const s=await setup();try{
 const j=s.bridge.enqueue({kind:'submit',problemId:'3008',code:'int main(){}'});
 await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth);
 await new Promise(r=>setTimeout(r,150));s.bridge.expire();
 assert.equal(j.state,'expired');assert.equal(j.code,undefined);assert.equal(j.result?.phase,'unknown');
 assert.equal((await (await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth)).json()).job,null);
 }finally{await s.bridge.close();}
});
test('只接受当前题号就绪的新版脚本，错题心跳不能冒充连接',async()=>{
 const s=await setup();try{
 assert.equal(s.bridge.connection('3008').canRunOnline,true);
 assert.equal(s.bridge.connection('178').canRunOnline,false);
 assert.throws(()=>s.bridge.enqueue({kind:'debug',problemId:'178',code:'x'}),/网页|连接/);
 await s.call('/poll',{problemId:'178',worker:'old'},s.auth);
 assert.equal(s.bridge.connection('178').kind,'needs-update');
 await s.call('/poll',{problemId:'178',worker:'old',protocol:2,editorReady:false,language:'cpp'},s.auth);
 assert.equal(s.bridge.connection('178').kind,'editor-unavailable');
 await s.call('/poll',{problemId:'178',worker:'old',protocol:2,editorReady:true,language:'cpp'},s.auth);
 assert.equal(s.bridge.connection('178').canRunOnline,true);
 const j=s.bridge.enqueue({kind:'debug',problemId:'178',code:'x'});
 assert.equal(s.bridge.connection('3008').kind,'busy');
 const take=await (await s.call('/poll',{problemId:'178',worker:'old',protocol:2,editorReady:false,language:'cpp'},s.auth)).json();
 assert.equal(take.job,null);
 assert.equal(j.state,'queued');
 }finally{await s.bridge.close();}
});
test('官方鉴权失败保持明确提示，直到用户重新检测；不推断已登录',async()=>{
 const s=await setup();try{
 const j=s.bridge.enqueue({kind:'debug',problemId:'3008',code:'x'});
 await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth);
 await s.call('/result',{id:j.id,worker:'a',result:{phase:'error',errorCode:'login_required',message:'HTTP 401'}},s.auth);
 await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth);
 assert.equal(s.bridge.connection('3008').kind,'login-required');
 s.bridge.recheck('3008');
 assert.equal(s.bridge.connection('3008').canRunOnline,false);
 await s.call('/poll',{problemId:'3008',worker:'a',protocol:2,editorReady:true,language:'cpp'},s.auth);
 assert.equal(s.bridge.connection('3008').canRunOnline,true);
 assert.match(s.bridge.connection('3008').detail,/登录.*未知/);
 }finally{await s.bridge.close();}
});
test('未监听或关闭后不能配对/排队，租约过期不能发送代码',async()=>{
 const b=new BridgeServer({token:'x',onImport:async()=>{},heartbeatTtlMs:25});
 assert.throws(()=>b.createPairing(),/服务/);
 assert.throws(()=>b.enqueue({kind:'debug',problemId:'3008',code:'x'}),/服务/);
 await b.close();await b.close();
 const s=await setup();try{
 s.bridge.recheck('3008');assert.equal(s.bridge.connection('3008').canRunOnline,false);
 }finally{await s.bridge.close();}
});
test('第二个窗口端口冲突后不能配对或发送在线任务',async()=>{
 const s=await setup(),other=new BridgeServer({token:'other',onImport:async()=>{}});
 try{
 await assert.rejects(()=>other.listen(s.bridge.port),(error:any)=>error.code==='EADDRINUSE');
 assert.equal(other.connection('3008').kind,'service-unavailable');
 assert.throws(()=>other.createPairing(),/服务/);
 assert.throws(()=>other.enqueue({kind:'submit',problemId:'3008',code:'x'}),/服务/);
 assert.equal(s.bridge.connection('3008').canRunOnline,true);
 }finally{await other.close();await s.bridge.close();}
});
test('C 任务只交给同题且 C 就绪的协议3页面，旧脚本或 C++ 页不能领取',async()=>{
 const s=await setup();try{
 const heartbeat={problemId:'3008',worker:'c',protocol:3,editorReady:true,language:'c'};
 assert.equal((await s.call('/poll',heartbeat,s.auth)).status,200);assert.equal(s.bridge.connection('3008','c').canRunOnline,true);
 const j=s.bridge.enqueue({kind:'debug',problemId:'3008',language:'c',sourceName:'main.c',code:'int main(void){}'});
 for(const h of [{...heartbeat,protocol:2},{...heartbeat,worker:'cpp',language:'cpp'},{...heartbeat,worker:'wrong',problemId:'178'}])assert.equal((await (await s.call('/poll',h,s.auth)).json()).job,null);
 const take=(await (await s.call('/poll',heartbeat,s.auth)).json()).job;assert.equal(take.id,j.id);assert.equal(take.language,'c');assert.equal(j.sourceName,'main.c');
 }finally{await s.bridge.close();}
});
