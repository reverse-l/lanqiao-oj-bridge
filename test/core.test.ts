import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mkdtemp, readFile, writeFile, readdir, symlink, mkdir, realpath} from 'node:fs/promises';
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
