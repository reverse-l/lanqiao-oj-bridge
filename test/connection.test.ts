import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionState} from '../src/connection';
test('租约过期失去在线权限；同题多个页面选择实际就绪的连接',()=>{
 const ready={problemId:'3008',worker:'a',seen:100,protocol:2,editorReady:true,language:'cpp'};
 assert.equal(connectionState(true,'3008',[ready],false,120,20).canRunOnline,false);
 assert.equal(connectionState(true,'3008',[{...ready,editorReady:false}, {...ready,worker:'b'}],false,110,20).canRunOnline,true);
 assert.equal(connectionState(false,'3008',[ready],false,110,20).canRunOnline,false);
});
