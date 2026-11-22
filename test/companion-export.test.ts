import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportCompanion} from '../src/storage';
const p={version:1 as const,id:'3075',title:'示例',url:'https://www.lanqiao.cn/problems/3075/learning/',markdown:'题面',tests:[{input:'1\n',output:'2\n'}],limits:{cpp:{timeLimit:1000},c:{timeLimit:2000}}};
test('仅显式导出当前 C / C++ 的 Companion 协议与题面样例，不附带代码',async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-export-'));
 for(const ext of ['cpp','c']){
  const source=path.join(dir,`main.${ext}`),target=path.join(dir,`companion.${ext}.json`);await writeFile(source,'PRIVATE SOLUTION');
  assert.equal(await exportCompanion(p,source,target),target);
  const raw=await readFile(target,'utf8'),data=JSON.parse(raw);assert.equal(data.srcPath,source);assert.equal(data.url,p.url);assert.equal(data.timeLimit,ext==='c'?2000:1000);assert.deepEqual(data.tests.map((t:any)=>({input:t.input,output:t.output})),p.tests);assert.doesNotMatch(raw,/PRIVATE SOLUTION/);
 }
});
test('已有导出拒绝覆盖；符号链接目标和源码都不能导出',async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-export-safe-')),source=path.join(dir,'main.cpp'),target=path.join(dir,'companion.json');await writeFile(source,'SOLUTION');await writeFile(target,'OLD');
 await assert.rejects(()=>exportCompanion(p,source,target),/已存在/);assert.equal(await readFile(target,'utf8'),'OLD');
 const linkTarget=path.join(dir,'linked.json');await symlink(target,linkTarget);await assert.rejects(()=>exportCompanion(p,source,linkTarget),/符号链接/);
 const linkSource=path.join(dir,'linked.cpp');await symlink(source,linkSource);await assert.rejects(()=>exportCompanion(p,linkSource,path.join(dir,'new.json')),/符号链接/);
 assert.equal(await readFile(source,'utf8'),'SOLUTION');
});
