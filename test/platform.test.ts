import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {executeOfficial} from '../src/browser/platform';
import type {PlatformResult} from '../src/report';

function website(options:{http?:number;report?:Record<string,unknown>;language?:string;wrongProblem?:boolean;networkError?:boolean;delayedSwitch?:boolean}={}){
 const {document}=parseHTML('<html><body><div class="online-judge-env"></div><button class="debug">调试</button><button id="oj-submit-btn">提交</button></body></html>');
 let code='// original webpage code';const requests:any[]=[];
 class XHR extends EventTarget {
  status=200;responseText='';responseType='';url='';
  open(_method:string,url:string){this.url=url;}
  send(body?:string){
   const payload=body?JSON.parse(body):{};requests.push({url:this.url,payload});
   if(options.networkError){setTimeout(()=>this.dispatchEvent(new Event('error')),0);return;}
   setTimeout(()=>{
    if(this.url.endsWith('/submit/')){this.status=options.http||200;this.responseText=JSON.stringify({submission_url:'https://opcenter.lanqiao.cn/api/v1/evaluation/questions/48475/submissions/test-real-id/?is_submit=false&judge_client=2'});}
    else if(this.url.includes('/submissions/'))this.responseText=JSON.stringify({code:0,data:{execute_status:2},message:'成功'});
    else this.responseText=JSON.stringify(options.report||{is_done:true,status:'AC',is_passed:true,message:'通过',error_msg:'',output_sample:'0\n1\n18\n32\n'});
    this.dispatchEvent(new Event('load'));
    if(this.url.endsWith('/submit/')&&this.status===200){const poll=new XHR();poll.open('GET','https://opcenter.lanqiao.cn/api/v1/evaluation/questions/48475/submissions/test-real-id/?is_submit=false&judge_client=2');poll.send();const report=new XHR();report.open('POST','https://www.lanqiao.cn/api/v2/problems/3008/submit-report/');report.send(JSON.stringify({submission_id:'test-real-id',is_submit:payload.is_submit}));}
   },0);
  }
 }
 const env:any={language:options.language||'cpp',submitting:false,inputSample:'',monacoEditor:{getValue:()=>code,setValue:(v:string)=>{code=v;}},debugOrSubmit:()=>{}};
 (document.querySelector('.online-judge-env') as any).__vue__=env;
 for(const b of document.querySelectorAll('button'))(b as any).click=()=>{const send=()=>{if(options.delayedSwitch){env.language='cpp';code='// saved C++ solution';}const xhr=new XHR();xhr.open('POST','https://www.lanqiao.cn/api/v2/problems/3008/submit/');xhr.send(JSON.stringify({language:env.language,submit_content:code,input_sample:env.inputSample,is_submit:b.id==='oj-submit-btn'}));};if(options.delayedSwitch)setTimeout(send,0);else send();};
 const page={document,location:{pathname:`/problems/${options.wrongProblem?'3009':'3008'}/learning/`,origin:'https://www.lanqiao.cn',href:'https://www.lanqiao.cn/problems/3008/learning/'},XMLHttpRequest:XHR};
 return {page:page as unknown as Window,requests,XHR,getCode:()=>code};
}
test('原生按钮发最新代码和自定义输入，结果关联 ID，操作后恢复 XHR 原型',async()=>{
 const w=website(),original=w.XHR.prototype.send,progress:PlatformResult[]=[],backups:string[]=[];
 const r=await executeOfficial(w.page,{kind:'debug',problemId:'3008',code:'// NEW',input:'4\n'},p=>progress.push(p),code=>backups.push(code));
 assert.equal(w.requests[0].payload.submit_content,'// NEW');assert.equal(w.requests[0].payload.input_sample,'4\n');assert.equal(w.requests[0].payload.is_submit,false);
 assert.deepEqual(progress.map(p=>p.phase),['sent','accepted','judging']);assert.equal(r.submissionId,'test-real-id');assert.equal(r.stdout,'0\n1\n18\n32\n');
 assert.deepEqual(backups,['// original webpage code']);assert.equal(w.XHR.prototype.send,original);
});
test('保底填入不发送提交；题号/语言不匹配不写编辑器',async()=>{
 const w=website();assert.equal((await executeOfficial(w.page,{kind:'prepare',problemId:'3008',code:'// prepared'},()=>{},()=>{})).phase,'prepared');assert.equal(w.requests.length,0);assert.equal(w.getCode(),'// prepared');
 for(const options of [{wrongProblem:true},{language:'java'}]){const w=website(options);await assert.rejects(()=>executeOfficial(w.page,{kind:'debug',problemId:'3008',code:'bad'},()=>{},()=>{}));assert.equal(w.getCode(),'// original webpage code');assert.equal(w.requests.length,0);}
});
test('官方登录错误与 CE 保持原义，不被适配器伪造为 AC',async()=>{
 const unauthorized=website({http:401});await assert.rejects(()=>executeOfficial(unauthorized.page,{kind:'debug',problemId:'3008',code:'x'},()=>{},()=>{}),/登录/);
 const w=website({report:{is_done:true,status:'CE',message:'编译失败',error_msg:'main.cpp: error',output_sample:''}});
 const result=await executeOfficial(w.page,{kind:'debug',problemId:'3008',code:'broken'},()=>{},()=>{});assert.equal(result.status,'CE');assert.equal(result.stderr,'main.cpp: error');assert.equal(result.time,undefined);
});
test('网络中断标记结果未知并恢复原型，不能误报平台已经接受',async()=>{
 const w=website({networkError:true}),original=w.XHR.prototype.send,progress:PlatformResult[]=[];
 const result=await executeOfficial(w.page,{kind:'debug',problemId:'3008',code:'x'},r=>progress.push(r),()=>{});
 assert.equal(result.phase,'unknown');assert.equal(result.status,undefined);assert.match(result.message!,/网络请求失败/);
 assert.deepEqual(progress.map(r=>r.phase),['sent']);assert.equal(w.XHR.prototype.send,original);
});
test('C 官方调试使用 C 编辑器与原生请求；错语言不能写代码',async()=>{
 const w=website({language:'c'});const r=await executeOfficial(w.page,{kind:'debug',problemId:'3008',language:'c',code:'int main(void){return 0;}',input:'1\n'},()=>{},()=>{});
 assert.equal(w.requests[0].payload.language,'c');assert.equal(r.phase,'done');
 const wrong=website();await assert.rejects(()=>executeOfficial(wrong.page,{kind:'debug',problemId:'3008',language:'c',code:'C CODE'},()=>{},()=>{}),/语言|C/);assert.equal(wrong.requests.length,0);assert.equal(wrong.getCode(),'// original webpage code');
});

test('C 正式请求延迟期间语言与编辑器代码同时变化，也必须阻止发送',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const w=website({language:'c',delayedSwitch:true}),original=w.XHR.prototype.send;
 const pending=executeOfficial(w.page,{kind:'submit',problemId:'3008',language:'c',code:'int main(void){return 0;}'},()=>{},()=>{});
 t.mock.timers.tick(120_001);
 await assert.rejects(pending,/不一致|变化/);
 assert.equal(w.requests.length,0);assert.equal(w.XHR.prototype.send,original);
});
