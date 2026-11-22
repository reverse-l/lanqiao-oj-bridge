import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mkdtemp, readFile, writeFile, readdir, symlink, mkdir, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseProblem, validateProblem, toCompanion} from '../src/problem';
import {importProblem} from '../src/storage';

const url='https://www.lanqiao.cn/problems/3008/learning/';
function documentOf(extra='') { return parseHTML(`<html><body><span class="course-name">1. 特殊的三角形</span><div class="markdown-body"><h3>问题描述</h3><p>值 <span class="katex"><annotation encoding="application/x-tex">v = a \\times b</annotation><span class="katex-html">乱码</span></span></p><p><img src="/image.png" alt="图"></p><h3>输入格式</h3><p>询问</p><h3>样例输入</h3><pre><code>4\n1 10\n30 50\n60 200\n200 400\n</code><div class="btn-copy">copy</div></pre><h3>样例输出</h3><pre><code>0\n1\n18\n32\n</code></pre>${extra}<h3>运行限制</h3><table><tr><th>语言</th><th>时间</th><th>内存</th></tr><tr><td>C++</td><td>1s</td><td>256M</td></tr></table></div></body></html>`).document as unknown as Document; }
test('题面保留 LaTeX、图片和原始样例，删除复制按钮',()=>{
 const p=parseProblem(documentOf(),url);
 assert.equal(p.id,'3008'); assert.equal(p.title,'特殊的三角形');
 assert.match(p.markdown,/\$v = a \\times b\$/); assert.doesNotMatch(p.markdown,/乱码|copy/);
 assert.match(p.markdown,/!\[图\]\(https:\/\/www.lanqiao.cn\/image.png\)/);
 assert.deepEqual(p.tests,[{input:'4\n1 10\n30 50\n60 200\n200 400\n',output:'0\n1\n18\n32\n'}]);
 assert.equal(p.timeLimit,1000); assert.equal(p.memoryLimit,256);
});
test('按样例标题提取多组，不把描述中的代码当样例',()=>{
 const doc=documentOf('<h3>样例输入 2</h3><pre><code>1\n</code></pre><h3>样例输出 2</h3><pre><code>2\n</code></pre><h3>提示</h3><pre><code>example();</code></pre>');
 assert.equal(parseProblem(doc,url).tests.length,2);
 doc.querySelector('h3')!.textContent='问题描述';
});
test('样例缺一半明确报错，登录页不能导入',()=>{
 assert.throws(()=>parseProblem(documentOf('<h3>样例输入 2</h3><pre><code>x</code></pre>'),url),/样例/);
 assert.throws(()=>parseProblem(parseHTML('<html><body>请登录</body></html>').document as unknown as Document,url),/题面|登录/);
});
test('全球变暖的输入输出样例引用块格式可以提取',()=>{
 const {document}=parseHTML('<html><body><span class="course-name">全球变暖</span><div class="markdown-body"><h3>题目描述</h3><pre><code>illustration</code></pre><h3>输入输出样例</h3><h4>示例</h4><blockquote><p>输入</p></blockquote><pre><code>2\n..\n..\n</code></pre><blockquote><p>输出</p></blockquote><pre><code>0\n</code></pre><h3>运行限制</h3></div></body></html>');
 assert.deepEqual(parseProblem(document as unknown as Document,'https://www.lanqiao.cn/problems/178/learning/').tests,[{input:'2\n..\n..\n',output:'0\n'}]);
});
test('协议验证拒绝伪造域名、题号错配和巨大样例',()=>{
 const p=parseProblem(documentOf(),url);
 for(const bad of [{...p,url:'https://www.lanqiao.cn.evil.com/problems/3008/'},{...p,id:'../x'},{...p,id:'123'},{...p,tests:[{input:'x'.repeat(600001),output:''}]}]) assert.throws(()=>validateProblem(bad));
 const cc=toCompanion(p,'/tmp/main.cpp');
 assert.equal(cc.srcPath,'/tmp/main.cpp'); assert.equal(cc.input.type,'stdin'); assert.equal(cc.tests[0].output,'0\n1\n18\n32\n'); assert.equal(typeof cc.tests[0].id,'number');
});
test('重复导入不覆盖代码、题面、自建样例或 CPH 文件，按题号复用目录',async()=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-test-')); const template=path.join(root,'template.cpp'); await writeFile(template,'// TEMPLATE\n');
 const p=parseProblem(documentOf(),url); const first=await importProblem(root,template,p);
 assert.equal(await readFile(first.source,'utf8'),'// TEMPLATE\n');
 assert.deepEqual((await readdir(first.directory)).sort(),['.cph','.lanqiao.json','README.md','3008.cpp','samples'].sort());
 await writeFile(first.source,'// MY SOLUTION'); await writeFile(path.join(first.directory,'README.md'),'MY NOTES');
 await writeFile(first.cphPath,'{"tests":[{"input":"custom"}]}');
 const second=await importProblem(root,template,{...p,title:'新标题'});
 assert.equal(second.source,first.source); assert.equal(await readFile(first.source,'utf8'),'// MY SOLUTION');
 assert.equal(await readFile(path.join(first.directory,'README.md'),'utf8'),'MY NOTES');
 assert.match(await readFile(first.cphPath,'utf8'),/custom/);
 assert.equal((await readdir(root)).filter(x=>x.startsWith('3008-')).length,1);
});
test('拒绝已存在的符号链接，标题中的路径字符不能逃出 root',async()=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-safe-')); const outside=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-out-'));
 const template=path.join(root,'template'); await writeFile(template,'x'); const p=parseProblem(documentOf(),url);
 await symlink(outside,path.join(root,'3008-特殊的三角形'));
 await assert.rejects(()=>importProblem(root,template,p),/符号链接/);
 const next=await importProblem(root,template,{...p,id:'3009',url:url.replace('3008','3009'),title:'../../escape'});
 assert.equal(path.dirname(next.directory),root);
 await mkdir(path.join(root,'3010-safe')); await symlink(path.join(outside,'stolen'),path.join(root,'3010-safe','main.cpp'));
 await assert.rejects(()=>importProblem(root,template,{...p,id:'3010',url:url.replace('3008','3010'),title:'safe'}),/符号链接/);
});
test('C 导入生成独立题号源码和样例记录，重复导入保留 C 与 C++ 解法',async()=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-c-'));const cppTemplate=path.join(root,'template.cpp'),cTemplate=path.join(root,'template.c');
 await writeFile(cppTemplate,'// CPP TEMPLATE\n');await writeFile(cTemplate,'/* C TEMPLATE */\n');const p=parseProblem(documentOf(),url);
 const cpp=await importProblem(root,cppTemplate,p);await writeFile(cpp.source,'// CPP SOLUTION');await writeFile(cpp.cphPath,'{"tests":[{"input":"CPP CUSTOM"}]}');
 const legacy=path.join(cpp.directory,'companion.json');await writeFile(legacy,'LEGACY EXPORT MUST STAY');
 const oldCpp=path.join(cpp.directory,'companion.cpp.json');await writeFile(oldCpp,'OLD CPP EXPORT');
 const c=await importProblem(root,cTemplate,p,'','c');assert.equal(path.basename(c.source),'3008.c');assert.equal(c.directory,cpp.directory);assert.equal(await readFile(c.source,'utf8'),'/* C TEMPLATE */\n');
 assert.notEqual(c.cphPath,cpp.cphPath);assert.equal(JSON.parse(await readFile(c.cphPath,'utf8')).srcPath,c.source);
 await writeFile(c.source,'/* C SOLUTION */');await writeFile(c.cphPath,'{"tests":[{"input":"C CUSTOM"}]}');
 const again=await importProblem(root,'',p,'','c');assert.equal(again.source,c.source);assert.equal(await readFile(c.source,'utf8'),'/* C SOLUTION */');assert.match(await readFile(c.cphPath,'utf8'),/C CUSTOM/);
 assert.equal(await readFile(cpp.source,'utf8'),'// CPP SOLUTION');assert.match(await readFile(cpp.cphPath,'utf8'),/CPP CUSTOM/);
 assert.equal(await readFile(legacy,'utf8'),'LEGACY EXPORT MUST STAY');assert.equal(await readFile(oldCpp,'utf8'),'OLD CPP EXPORT');assert.equal((await readdir(c.directory)).includes('companion.c.json'),false);
});
test('C 未指定模板时提供基础模板，不依赖或修改 C++ 模板',async()=>{
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-c-template-'));const c=await importProblem(root,'',parseProblem(documentOf(),url),'','c');
 assert.equal(path.basename(c.source),'3008.c');assert.match(await readFile(c.source,'utf8'),/#include <stdio.h>/);
});
test('命名设置只影响创建，登记的自定义源码和旧 main.cpp 优先复用', async t => {
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'lanqiao-naming-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const template=path.join(root,'template.cpp');
 await writeFile(template,'// template');
 const rank=(id:string,title:string)=>({...parseProblem(documentOf(),url),id,title,url:url.replace('3008',id)});
 const old=rank('3263','【练习】选题');
 const legacy=await importProblem(root,template,old,'','cpp',undefined,{naming:'main'});
 assert.equal(path.basename(legacy.source),'main.cpp');
 await writeFile(legacy.source,'// existing');
 assert.equal((await importProblem(root,template,old)).source,legacy.source);
 assert.deepEqual((await readdir(legacy.directory)).filter(file=>file.endsWith('.cpp')),['main.cpp']);
 const fresh=rank('17003','【练习】霓虹');
 const numbered=await importProblem(root,template,fresh);
 assert.equal(path.basename(numbered.source),'17003.cpp');
 assert.equal((await importProblem(root,template,fresh,'','cpp',undefined,{naming:'main'})).source,numbered.source);
 const custom=path.join(numbered.directory,'working.cpp');
 await writeFile(custom,'// keep custom');
 const changedRoot=path.join(root,'new root');
 const reused=await importProblem(changedRoot,'',fresh,'','cpp',undefined,{existingSource:custom});
 assert.equal(reused.source,custom);
 assert.equal(reused.created,false);
 assert.equal(await readFile(reused.source,'utf8'),'// keep custom');
 assert.equal(JSON.parse(await readFile(reused.cphPath,'utf8')).srcPath,custom);
 await assert.rejects(importProblem(root,template,{...fresh,id:'../17003'}),/题号或 URL 无效/);
});
test('C 资源限制使用对应语言行，不能误用 C++ 时限',()=>{
 const doc=documentOf();const table=doc.querySelector('table')!;table.insertAdjacentHTML('beforeend','<tr><td>C</td><td>2s</td><td>128M</td></tr>');
 const p=parseProblem(doc,url),cc=toCompanion(p,'/tmp/main.c');assert.equal(cc.timeLimit,2000);assert.equal(cc.memoryLimit,128);assert.equal(toCompanion(p,'/tmp/main.cpp').timeLimit,1000);
});
