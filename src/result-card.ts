import type {Job} from './bridge';
import {displayResult,usesInputDebug} from './output';
import {COPY_ICON} from './copy-icon';
export type SavedJob=Omit<Job,'code'|'input'>;
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const readable=(value:string)=>value.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
const text=(value:unknown)=>value===undefined?'未提供':escapeHtml(readable(typeof value==='string'?value:JSON.stringify(value)??String(value)));
const phases={prepared:'代码已填入，尚未提交',sent:'请求已发送',accepted:'平台已接受',judging:'正在评测',done:'评测完成',error:'操作失败',unknown:'结果未知'};
export function renderResultCard(job?:SavedJob):string {
 if(!job)return '<p class="empty-result">本题尚无在线记录。CPH 本地测试结果请在 CPH 面板查看。</p>';
 const inputDebug=usesInputDebug(job),r=job.result?displayResult(job.result,inputDebug):undefined,phase=r?.phase;
 const verdict=phase==='done'?(inputDebug?'执行已结束':r?.status||phases.done):phase?phases[phase]:job.state==='queued'?'等待网页接收':'网页已接收，等待官方请求';
 const stream=(key:'stdout'|'stderr',label:string,action:string)=>`<details ${key==='stderr'&&r?.stderr?'open':''}><summary>${label}</summary><div class="copy-block">${r?.[key]!==undefined?`<button type="button" class="copy-button" data-action="${action}" aria-label="复制${label}" title="复制${label}">${COPY_ICON}</button>`:''}<pre>${r?.[key]===undefined?'未提供':r[key]===''?'（空）':text(r[key])}</pre></div></details>`;
 const cases=r?.testCases?.map((value,index)=>{const c=value&&typeof value==='object'?value as Record<string,unknown>:{};return `<tr><td>${index+1}</td><td>${text(c.result??c.status)}</td><td>${text(c.millisecond)}</td><td>${text(c.memory)}</td></tr>`;}).join('');
 return `<section class="result-card" aria-label="官方结果"><div class="result-heading"><strong>${job.kind==='debug'?'官方在线自测':job.kind==='submit'?'正式提交':'网页填入'}</strong> <span>#${escapeHtml(job.problemId)}</span><span class="verdict">${text(verdict)}</span></div>
<p class="result-date">${text(new Date(job.created).toLocaleString())} · ${inputDebug?'使用指定输入，仅展示执行结果':job.kind==='debug'?'官方调试':'官方记录以蓝桥网页为准'}</p>
${r?.message?`<p class="platform-message">${text(r.message)}</p>`:''}
${phase==='unknown'?'<p>无法确认最终结果。请先查看官方记录，避免重复提交。</p><button data-action="open">打开原题查看官方记录</button>':''}
<dl class="metrics"><div><dt>运行时间（ms）</dt><dd data-field="runtime">${text(r?.runtime)}</dd></div><div><dt>内存（平台 kb）</dt><dd data-field="memory">${text(r?.memory)}</dd></div>${inputDebug?'':`<div><dt>通过率（%）</dt><dd>${text(r?.passRate)}</dd></div>`}</dl>
${r?.time!==undefined?`<p>平台 time 原值：${text(r.time)}</p>`:''}
<p>官方记录 ID：<code>${text(r?.submissionId)}</code> ${r?.submissionId?'<button data-action="copyId">复制 ID</button>':''}</p>
${stream('stdout','标准输出','copyOutput')}${stream('stderr','标准错误 / 编译错误','copyError')}
${cases?`<details><summary>官方测试点（${r!.testCases!.length}）</summary><table><thead><tr><th>序号</th><th>平台结果</th><th>ms</th><th>内存（平台原值）</th></tr></thead><tbody>${cases}</tbody></table></details>`:''}</section>`;
}
export function recoverHistory(value:unknown,ownsBridge=true):SavedJob[]{
 if(!Array.isArray(value))return [];
 return value.filter(j=>j&&typeof j.id==='string'&&/^\d{1,10}$/.test(j.problemId)&&['debug','submit','prepare'].includes(j.kind)&&Number.isFinite(j.created)).slice(-50).map(({code,input,...job})=>{
  if(ownsBridge&&(job.state==='queued'||job.state==='claimed'))return {...job,state:'expired',result:{phase:job.state==='claimed'?'unknown':'error',...(job.result?.submissionId?{submissionId:job.result.submissionId}:{}),message:job.state==='claimed'?'VSCode 已重载，未取得最终结果；请查看官方记录，不会自动重新发送。':'VSCode 已重载，未发送的本地任务已取消。'}} as SavedJob;
  return job as SavedJob;
 });
}
