import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatResult} from '../src/output';
test('输出保留真实换行，清理 ANSI 编译颜色，不填造资源数据',()=>{
 const out=formatResult({phase:'done',status:'CE',stdout:'0\n1\n18\n32\n',stderr:'\u001b[31merror: bad\u001b[0m'});
 assert.ok(out.includes('0\n1\n18\n32\n'));assert.ok(out.includes('error: bad'));assert.ok(!out.includes('\u001b'));assert.ok(!out.includes('运行时间'));assert.ok(!out.includes('内存：'));
});
test('带输入的调试隐藏评测结论，保留输出；正式提交和官方调试仍显示状态',()=>{
 const r={phase:'done' as const,status:'WA',message:'答案错误',stdout:'145728\n',passRate:0,testCases:[{result:'答案错误'}]};
 const out=formatResult(r,true);assert.match(out,/145728/);assert.doesNotMatch(out,/WA|答案错误|通过率|官方测试点/);
 assert.match(formatResult(r),/WA/);assert.equal(r.status,'WA');
 assert.match(formatResult({phase:'done',status:'TLE'},true),/运行超时/);
 assert.match(formatResult({phase:'error',message:'登录失效'},true),/登录失效/);
});
