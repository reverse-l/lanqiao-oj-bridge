const passed=new Set(['AC','ACCEPTED','通过','正确','答案正确']);
const failed=new Set(['WA','TLE','MLE','RE','CE','OLE','PE','答案错误','运行超时','时间超限','内存超限','运行错误','运行时错误','编译错误','编译失败','输出超限','格式错误','未通过']);
export function testCaseSummary(cases:unknown[]|undefined):string|undefined {
 if(!cases)return;
 let pass=0,unknown=0;
 for(const value of cases){
  const c=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const label=typeof c.result==='string'?c.result:typeof c.status==='string'?c.status:'';
  const name=label.trim().toUpperCase();
  const result=passed.has(name)?true:failed.has(name)?false:undefined;
  const status=typeof c.status==='boolean'?c.status:undefined;
  const outcome=status!==undefined&&result!==undefined&&status!==result?undefined:status??result;
  if(outcome===true)pass++;else if(outcome===undefined)unknown++;
 }
 if(!cases.length||unknown===cases.length)return `测试点：${cases.length} 个；通过情况未提供`;
 return `通过 ${pass} / ${cases.length} 个测试点${unknown?`（${unknown} 个结果未明确）`:''}`;
}
