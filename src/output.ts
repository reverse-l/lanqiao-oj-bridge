import {PlatformResult} from './report';
const readable=(s:string)=>s.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
export const usesInputDebug=(job:{kind:string;debugMode?:string})=>job.kind==='debug'&&job.debugMode!=='official';
export function displayResult(r:PlatformResult,inputDebug=false):PlatformResult {
 if(!inputDebug)return r;
 const {status,passRate,testCases,...rest}=r;
 if(r.phase==='done'){
  const failures:Record<string,string>={CE:'编译失败',RE:'运行时错误',TLE:'运行超时',MLE:'内存超限',OLE:'输出超限'};
  rest.message=status?failures[status]:undefined;
 }
 return rest;
}
export function formatResult(raw:PlatformResult,inputDebug=false){
 const r=displayResult(raw,inputDebug);
 const lines=[inputDebug&&r.phase==='done'?'调试执行已结束':`阶段：${r.phase}`];
 if(r.status)lines.push(`平台状态：${r.status}`);
 if(r.submissionId)lines.push(`官方记录 ID：${r.submissionId}`);
 if(r.message)lines.push(`平台信息：${readable(r.message)}`);
 if(r.runtime!==undefined)lines.push(`运行时间（平台 runtime，ms）：${r.runtime}`);
 if(r.time!==undefined)lines.push(`平台 time 原值：${JSON.stringify(r.time)}`);
 if(r.memory!==undefined)lines.push(`内存：${r.memory} kb（平台原值）`);
 if(r.passRate!==undefined)lines.push(`通过率：${r.passRate}%`);
 if(r.stdout!==undefined)lines.push(`标准输出：\n${r.stdout}`);
 if(r.stderr)lines.push(`标准错误 / 编译错误：\n${readable(r.stderr)}`);
 if(r.testCases)lines.push(`官方测试点：\n${JSON.stringify(r.testCases,null,2)}`);
 return lines.join('\n');
}
