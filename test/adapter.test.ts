import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretReport,httpFailure} from '../src/report';
test('调试保留平台输出和 CE，未完成的响应不能判 AC',()=>{
 assert.deepEqual(interpretReport({is_done:true,status:'AC',is_passed:true,message:'通过',error_msg:'',output_sample:'42\n'}),{phase:'done',status:'AC',message:'通过',stdout:'42\n',stderr:''});
 const ce=interpretReport({is_done:true,status:'CE',is_passed:false,message:'编译失败',error_msg:'main.cpp: error',output_sample:''});
 assert.equal(ce.status,'CE');assert.equal(ce.stderr,'main.cpp: error');assert.equal(ce.time,undefined);
 assert.equal(interpretReport({is_done:false,status:'AC'}).phase,'judging');
 assert.equal(interpretReport({is_done:true,message:'通过'}).status,undefined);
});
test('HTTP 错误区分登录、限流与服务器失败',()=>{
 assert.match(httpFailure(401),/登录/);assert.match(httpFailure(403),/登录|权限/);assert.match(httpFailure(429),/频率/);assert.match(httpFailure(500),/500/);
});
test('保留正式报告真实 runtime、memory、通过率，以及 TLE/RE 等状态',()=>{
 const report=interpretReport({is_done:true,status:'AC',runtime:5,memory:6656,pass_rate:100});
 assert.equal(report.runtime,5);assert.equal(report.memory,6656);assert.equal(report.passRate,100);
 for(const status of ['WA','TLE','RE','CE','MLE'])assert.equal(interpretReport({is_done:true,status}).status,status);
});
