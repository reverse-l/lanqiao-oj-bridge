export type Phase='prepared'|'sent'|'accepted'|'judging'|'done'|'error'|'unknown';
export interface PlatformResult {
 phase:Phase; status?:string; submissionId?:string; message?:string; stdout?:string; stderr?:string;errorCode?:'login_required';
 time?:unknown; runtime?:unknown; memory?:unknown; passRate?:unknown; testCases?:unknown[];
}
export function interpretReport(value:unknown):PlatformResult {
 const r=value as Record<string,unknown>;
 if(!r||typeof r!=='object') throw new Error('官方报告格式变化');
 if(r.is_done!==true) return {phase:'judging'};
 return {phase:'done',...(typeof r.status==='string'?{status:r.status}:{}),...(typeof r.message==='string'?{message:r.message}:{}),...(typeof r.output_sample==='string'?{stdout:r.output_sample}:{}),...(typeof r.error_msg==='string'?{stderr:r.error_msg}:{}),...(r.time!==undefined?{time:r.time}:{}),...(r.runtime!==undefined?{runtime:r.runtime}:{}),...(r.memory!==undefined?{memory:r.memory}:{}),...(r.pass_rate!==undefined?{passRate:r.pass_rate}:{}),...(Array.isArray(r.test_cases)?{testCases:r.test_cases}: {})};
}
export function httpFailure(status:number):string {
 if(status===401||status===403)return `登录失效或权限不足（HTTP ${status}），请在蓝桥网页重新登录；不会自动重试提交。`;
 if(status===429)return '操作频率受限（HTTP 429），请稍后手动重试。';
 return `官方请求失败（HTTP ${status}），请在网页查看详情。`;
}
