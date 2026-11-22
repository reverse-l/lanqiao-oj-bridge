import {httpFailure,interpretReport,PlatformResult} from '../report';
import type {JobRequest} from '../bridge';
import {LANGUAGES,requireLanguage} from '../languages';
import {resolvePageContext} from './page-context';

// 唯一依赖蓝桥当前 Vue 2 / Monaco DOM 的模块；不读取 Cookie、JWT 或登录存储。
export const SELECTORS={environment:'.online-judge-env',debug:'button.debug',submit:'#oj-submit-btn',title:'.course-name',statement:'.markdown-body'};
export function environment(page:Window):any {
 const env=(page.document.querySelector(SELECTORS.environment) as any)?.__vue__;
 if(!env||typeof env.monacoEditor?.getValue!=='function'||typeof env.monacoEditor?.setValue!=='function'||typeof env.debugOrSubmit!=='function')throw new Error('官方编辑器未就绪、未登录或页面结构已变化，请等待加载并检查网页。');
 return env;
}
export function editorReadiness(page:Window):{editorReady:boolean;language:string}{
 try{const env=environment(page);const debug=page.document.querySelector<HTMLButtonElement>(SELECTORS.debug),submit=page.document.querySelector<HTMLButtonElement>(SELECTORS.submit);return {editorReady:!!debug&&!debug.disabled&&!!submit&&!submit.disabled&&!env.submitting,language:typeof env.language==='string'?env.language:''};}
 catch{return {editorReady:false,language:''};}
}
export class OfficialError extends Error {constructor(message:string,public errorCode?:'login_required'){super(message);}}
export async function executeOfficial(page:Window,job:JobRequest,progress:(r:PlatformResult)=>void,backup:(code:string)=>void):Promise<PlatformResult>{
 const context=resolvePageContext(page);
 if(!context||context.id!==job.problemId)throw new Error('页面题号与任务不一致，或课程单元尚未就绪，已停止');
 const env=environment(page);
 if(env.submitting)throw new Error('网站正在运行或评测，请完成后手动重试');
 const language=requireLanguage(job.language),label=LANGUAGES[language].officialLabel;
 if(env.language!==language)throw new Error(`请先把官方网页编译语言切换为 ${label} 后重试`);
 const button=page.document.querySelector<HTMLButtonElement>(job.kind==='debug'?SELECTORS.debug:SELECTORS.submit);
 if(!button||button.disabled)throw new Error('原生调试/提交按钮不可用，请检查登录状态或网页改版');
 backup(env.monacoEditor.getValue());env.monacoEditor.setValue(job.code);
 if(env.monacoEditor.getValue()!==job.code)throw new Error('官方编辑器代码写入校验失败，停止操作');
 if(env.language!==language)throw new Error('代码填入期间网页语言发生变化，已停止');
 if(job.kind==='prepare')return {phase:'prepared',message:`最新代码已填入官方 ${label} 编辑器，请由用户点击网站原生「提交检测」。此状态不表示已提交。`};
 env.inputSample=job.kind==='debug'?job.input||'':'';
 return new Promise<PlatformResult>((resolve,reject)=>{
  const proto=(page as any).XMLHttpRequest.prototype;
  const originalOpen=proto.open,originalSend=proto.send;
  const urls=new WeakMap<XMLHttpRequest,string>(),pollUrls=new Set<string>();let submissionId:string|undefined,settled=false,judgingSeen=false;
  const finish=(r?:PlatformResult,error?:Error)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(proto.open===open)proto.open=originalOpen;if(proto.send===send)proto.send=originalSend;
   if(error)reject(error);else resolve({...r!,...(submissionId?{submissionId}:{})});
  };
  const timer=setTimeout(()=>finish({phase:'unknown',message:'官方运行结果等待超时；请检查网页和提交记录，避免重复提交。'}),120_000);
  const open=function(this:XMLHttpRequest,method:string,url:string,...rest:any[]){
   try{urls.set(this,new URL(url,page.location.href).href);}catch{}
   return originalOpen.call(this,method,url,...rest);
  };
  const send=function(this:XMLHttpRequest,body:any){
   const url=urls.get(this)||'';const base=`${page.location.origin}/api/v2/problems/${job.problemId}/`;
   let payload:any;try{payload=typeof body==='string'?JSON.parse(body):null;}catch{}
   const submitUrl=context.kind==='course'?`${page.location.origin}/api/v2/labs/${context.labId}/online_judge/submit/`:`${base}submit/`;
   const isSubmit=url===submitUrl;
   const anySubmit=url.startsWith(`${page.location.origin}/api/v2/`)&&/\/(?:problems\/\d+|labs\/\d+\/online_judge)\/submit\/(?:\?.*)?$/.test(url);
   if(anySubmit&&(!isSubmit||resolvePageContext(page)?.key!==context.key||payload?.language!==language||payload?.submit_content!==job.code||payload?.is_submit!==(job.kind==='submit')||(context.kind==='course'&&String(payload?.problem_id)!==job.problemId))){
    finish(undefined,new Error('官方请求的语言、代码或操作类型与已确认任务不一致，已阻止发送'));
    if(typeof this.abort==='function')this.abort();return;
   }
   const isReport=url===`${base}submit-report/`&&submissionId&&payload?.submission_id===submissionId&&payload?.is_submit===(job.kind==='submit');
   const isPoll=pollUrls.has(url);
   if(isPoll&&!judgingSeen){judgingSeen=true;progress({phase:'judging',submissionId,message:'网站正在查询官方运行 / 评测状态。'});}
   if(isSubmit||isReport||isPoll){
    if(isSubmit)progress({phase:'sent',message:'请求已由网站原生流程发送，等待平台接受。'});
    this.addEventListener('load',()=>{
     if(settled)return;
     if(this.status<200||this.status>=300){finish(undefined,new OfficialError(httpFailure(this.status),this.status===401||this.status===403?'login_required':undefined));return;}
     if(isPoll&&context.kind!=='course')return;
     let data:any;try{data=this.responseType==='json'?this.response:JSON.parse(this.responseText);}catch{finish(undefined,new Error('官方响应无法解析，可能登录失效或页面改版'));return;}
     if(isSubmit){
      if(typeof data.submission_url!=='string'){finish(undefined,new Error('平台未返回 submission_url，不能确认已接受；请检查网页登录、验证码或频率限制'));return;}
      try{const u=new URL(data.submission_url,page.location.origin);if(!['https://opcenter.lanqiao.cn',page.location.origin].includes(u.origin)||u.username||u.password)throw new Error();submissionId=u.pathname.match(/\/submissions\/([\w-]+)\/?$/)?.[1];if(!submissionId)throw new Error();pollUrls.add(u.href);pollUrls.add(u.href.replace('https://opcenter.lanqiao.cn/api/v1',`${page.location.origin}/opcenter`));}
      catch{finish(undefined,new Error('平台提交记录地址格式变化，停止自动识别'));return;}
      progress({phase:'accepted',submissionId,message:'平台已接受，等待官方评测完成。'});
     }else{
      const result=interpretReport(data);
      if(result.phase==='done')finish(result);else progress({...result,submissionId});
     }
    },{once:true});
    this.addEventListener('error',()=>finish({phase:'unknown',message:'官方网络请求失败，无法确认平台是否收到；请查看官方记录，提交不会自动重试'}),{once:true});
    this.addEventListener('timeout',()=>finish({phase:'unknown',message:'官方网络请求超时，请先查看网站记录。'}),{once:true});
   }
   return originalSend.call(this,body);
  };
  proto.open=open;proto.send=send;
  // 使用网站原生按钮，官方代码负责认证、验证码、限流和评测轮询。
  try{if(env.language!==language)throw new Error('网页语言已变化，停止发送');button.click();}catch(error){finish(undefined,error as Error);}
 });
}
