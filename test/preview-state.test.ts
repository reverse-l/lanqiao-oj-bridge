import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewState,parsePreviewMessage} from '../src/preview-state';
test('恢复仅信任宿主登记的来源；滚动值必须有限非负',()=>{
 const source='/tmp/qa/main.cpp';
 assert.deepEqual(parsePreviewState({version:1,source,scrollY:350},[source]),{version:1,source,scrollY:350});
 for(const state of [{source,scrollY:1},{version:1,source:'/etc/passwd',scrollY:0},{version:1,source,scrollY:Infinity},{version:1,source,scrollY:-1}])assert.equal(parsePreviewState(state,[source]),undefined);
});
test('客户端消息无法扩展动作的题号/文件/代码；滚动消息只传阅读位置',()=>{
 assert.deepEqual(parsePreviewMessage({action:'copyBlock',index:0}),{action:'copyBlock',index:0});
 for(const value of [{action:'copyBlock',index:-1},{action:'copyBlock',index:1.2},{action:'copyBlock',index:0,text:'x'},{action:'copyBlock',index:0,file:'/etc/passwd'}])assert.equal(parsePreviewMessage(value),undefined);
 assert.deepEqual(parsePreviewMessage({type:'viewState',scrollY:20}),{type:'viewState',scrollY:20});
 assert.deepEqual(parsePreviewMessage({action:'copyOutput'}),{action:'copyOutput'});
 assert.deepEqual(parsePreviewMessage({type:'ready'}),{type:'ready'});
 for(const value of [{type:'ready',source:'/etc/passwd'},{type:'viewState',scrollY:-1},{type:'viewState',scrollY:20,source:'/tmp/a'},{action:'submit',file:'/tmp/a'}, {action:'copyOutput',text:'malicious'}])assert.equal(parsePreviewMessage(value),undefined);
});
