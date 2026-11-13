import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testCaseSummary} from '../src/test-case-summary';
test('布尔、中文与 AC 状态明确计数，false 不是未知结果',()=>{
 assert.equal(testCaseSummary([{status:true,result:'通过'},{status:false,result:'答案错误'},{result:'AC'},{status:'TLE'}]),'通过 2 / 4 个测试点');
});
test('缺失、空、矛盾及未识别的结果不能伪造为通过',()=>{
 assert.equal(testCaseSummary(undefined),undefined);
 assert.equal(testCaseSummary([]),'测试点：0 个；通过情况未提供');
 assert.equal(testCaseSummary([null,{status:1},{status:false,result:'通过'}]),'测试点：3 个；通过情况未提供');
});
