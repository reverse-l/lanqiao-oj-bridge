import type {Job} from './bridge';
import {displayResult,usesInputDebug} from './output';
import {LANGUAGES} from './languages';
import {COPY_ICON} from './copy-icon';
import {testCaseSummary} from './test-case-summary';
export type SavedJob=Omit<Job,'code'|'input'>;
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const readable=(value:string)=>value.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
const text=(value:unknown)=>value===undefined?'未提供':escapeHtml(readable(typeof value==='string'?value:JSON.stringify(value)??String(value)));
const phases={prepared:'代码已填入，尚未提交',sent:'请求已发送',accepted:'平台已接受',judging:'正在评测',done:'评测完成',error:'操作失败',unknown:'结果未知'};
export function renderResultCard(job?:SavedJob):string {
 if(!job)return '';
 const inputDebug=usesInputDebug(job),r=job.result?displayResult(job.result,inputDebug):undefined,phase=r?.phase;
 const verdict=phase==='done'?(inputDebug?'执行已结束':r?.status||phases.done):phase?phases[phase]:job.state==='queued'?'等待网页接收':'网页已接收，等待官方请求';
 const stream=(key:'stdout'|'stderr',label:string,action:string)=>r?.[key]===undefined?'':`<details ${key==='stderr'&&r.stderr?'open':''}><summary>${label}</summary><div class="copy-block"><button type="button" class="copy-button" data-action="${action}" aria-label="复制${label}" title="复制${label}">${COPY_ICON}</button><pre>${r[key]===''?'（空）':text(r[key])}</pre></div></details>`;
 const summary=testCaseSummary(r?.testCases);
 const metric=(label:string,value:unknown,field='')=>value===undefined?'':`<div><dt>${label}</dt><dd${field?` data-field="${field}"`:''}>${text(value)}</dd></div>`;
 return `<section class="result-card" aria-label="官方结果"><div class="result-heading" title="${text(new Date(job.created).toLocaleString())} · ${text(LANGUAGES[job.language||'cpp'].officialLabel)} · ${text(job.sourceName||'main.cpp')}"><strong>${job.kind==='debug'?'官方在线自测':job.kind==='submit'?'正式提交':'网页填入'}</strong> <span>#${escapeHtml(job.problemId)}</span><span class="verdict">${text(verdict)}</span></div>
${r?.message?`<p class="platform-message">${text(r.message)}</p>`:''}
${phase==='unknown'?'<p>无法确认最终结果。请先查看官方记录，避免重复提交。</p><button data-action="open">打开原题查看官方记录</button>':''}
${summary?`<p class="case-summary">${text(summary)}</p>`:''}
<dl class="metrics">${metric('用时（ms）',r?.runtime,'runtime')}${metric('内存（kb）',r?.memory,'memory')}${inputDebug||summary?'':metric('通过率（%）',r?.passRate)}</dl>
${r?.submissionId?`<button data-action="copyId" title="${text(r.submissionId)}">复制记录 ID</button>`:''}
${stream('stdout','标准输出','copyOutput')}${stream('stderr','标准错误 / 编译错误','copyError')}
</section>`;
}
export function recoverHistory(value:unknown,ownsBridge=true):SavedJob[]{
 if(!Array.isArray(value))return [];
 return value.filter(j=>j&&typeof j.id==='string'&&/^\d{1,10}$/.test(j.problemId)&&['debug','submit','prepare'].includes(j.kind)&&Number.isFinite(j.created)).slice(-50).map(({code,input,...job})=>{
  if(ownsBridge&&(job.state==='queued'||job.state==='claimed'))return {...job,state:'expired',result:{phase:job.state==='claimed'?'unknown':'error',...(job.result?.submissionId?{submissionId:job.result.submissionId}:{}),message:job.state==='claimed'?'VSCode 已重载，未取得最终结果；请查看官方记录，不会自动重新发送。':'VSCode 已重载，未发送的本地任务已取消。'}} as SavedJob;
  return job as SavedJob;
 });
}
