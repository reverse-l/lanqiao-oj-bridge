import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,realpath,link,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ensureCphProblem,restoreEmptyCphProblem} from '../src/storage';
test('源码路径更正时复制旧 CPH 自定义测试，旧文件保留且不覆盖目标记录',async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-cph-identity-'));
 await mkdir(path.join(dir,'old'));await mkdir(path.join(dir,'canonical'));
 const oldSource=path.join(dir,'old','main.c'),source=path.join(dir,'canonical','main.c');
 await writeFile(oldSource,'// user code');await link(oldSource,source);
 const p={version:1 as const,id:'2377',title:'特殊年份',url:'https://www.lanqiao.cn/problems/2377/learning/',markdown:'题目',tests:[{input:'2021',output:'1'}]};
 const old=await ensureCphProblem(p,oldSource);
 const original=JSON.stringify({srcPath:oldSource,tests:[{input:'CUSTOM',output:'KEEP',id:42}]});await writeFile(old.path,original);
 const migrated=await ensureCphProblem(p,source,'',oldSource);
 assert.equal(JSON.parse(await readFile(migrated.path,'utf8')).tests[0].input,'CUSTOM');
 assert.equal(JSON.parse(await readFile(migrated.path,'utf8')).srcPath,source);
 assert.equal(await readFile(old.path,'utf8'),original);
 await writeFile(migrated.path,JSON.stringify({tests:[{input:'NEW USER CASE'}]}));
 await ensureCphProblem(p,source,'',oldSource);
 assert.equal(JSON.parse(await readFile(migrated.path,'utf8')).tests[0].input,'NEW USER CASE');
});
test('发送至 CPH 为绑定的 main.cpp 建立样例，保留用户已有测试',async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-cph-')),source=path.join(dir,'main.cpp');await writeFile(source,'// solution');
 const p={version:1 as const,id:'3008',title:'特殊的三角形',url:'https://www.lanqiao.cn/problems/3008/learning/',markdown:'题目',tests:[{input:'1\n30 50\n',output:'1\n'}]};
 const first=await ensureCphProblem(p,source);const data=JSON.parse(await readFile(first.path,'utf8'));assert.equal(data.srcPath,source);assert.equal(data.tests[0].input,'1\n30 50\n');assert.equal(first.created,true);
 await writeFile(first.path,'{"tests":[{"input":"USER CASE"}]}');
 assert.equal((await ensureCphProblem(p,source)).created,false);assert.match(await readFile(first.path,'utf8'),/USER CASE/);assert.equal(await readFile(source,'utf8'),'// solution');
});
test('确认恢复空 CPH 时先保留备份，非空自定义样例绝不替换',async()=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-cph-restore-')),source=path.join(dir,'main.cpp');await writeFile(source,'// solution');
 const p={version:1 as const,id:'178',title:'全球变暖',url:'https://www.lanqiao.cn/problems/178/learning/',markdown:'题目',tests:[{input:'2\n..\n..\n',output:'0\n'}]};
 const file=await ensureCphProblem({...p,tests:[]},source),before=await readFile(file.path,'utf8');
 const result=await restoreEmptyCphProblem(p,source);assert.equal(result.restored,true);assert.equal(await readFile(result.backup!,'utf8'),before);assert.equal(JSON.parse(await readFile(file.path,'utf8')).tests[0].output,'0\n');
 await writeFile(file.path,'{"tests":[{"input":"CUSTOM","output":"X"}]}');assert.equal((await restoreEmptyCphProblem(p,source)).restored,false);assert.match(await readFile(file.path,'utf8'),/CUSTOM/);assert.equal(await readFile(source,'utf8'),'// solution');
});
