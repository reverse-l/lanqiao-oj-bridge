import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceCph} from '../src/cph-diagnostics';

test('CPH 在等待扩展激活期间也留下开始及当前阶段日志',async()=>{
 const logs:string[]=[];let release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 const run=traceCph(text=>logs.push(text),async step=>{
  await step('激活 CPH',()=>waiting);
  return '已读取 1 组样例';
 });
 assert.match(logs.join('\n'),/开始/);
 assert.match(logs.join('\n'),/激活 CPH/);
 assert.doesNotMatch(logs.join('\n'),/已读取/);
 release();assert.equal(await run,'已读取 1 组样例');
 assert.match(logs.at(-1)!,/已读取 1 组样例/);
});

test('CPH 错误保留发生阶段及原始原因，随后向调用者抛出',async()=>{
 const logs:string[]=[],error=new Error('EACCES');
 await assert.rejects(traceCph(text=>logs.push(text),async step=>{
  await step('写入样例记录',async()=>{throw error;});return '不应完成';
 }),e=>e===error);
 assert.match(logs.at(-1)!,/写入样例记录.*EACCES/);
 assert.doesNotMatch(logs.join('\n'),/不应完成/);
});
