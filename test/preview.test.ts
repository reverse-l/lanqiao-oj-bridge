import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderProblemPreview,parsePreviewAction,markdownCodeBlocks} from '../src/preview';

const p={id:'3008',title:'特殊的三角形',url:'https://www.lanqiao.cn/problems/3008/learning/',markdown:'# 3008 特殊的三角形\n\n$a \\times b$\n\n```cpp\nint main() {}\n```\n\n![图片](https://assets.lanqiao.cn/a.png)\n',version:1 as const,tests:[]};
function html(markdown=p.markdown){return renderProblemPreview({...p,markdown},{nonce:'safe-nonce',cspSource:'vscode-resource:',katexCss:'vscode-resource:/katex.css'});}
test('题面内有 CPH 与提交入口，公式/代码/图片继续显示',()=>{
 const {document}=parseHTML(html());
 assert.equal(document.querySelector('button[data-action="sendToCph"]')?.textContent?.trim(),'发送至 CPH');
 assert.equal(document.querySelector('button[data-action="submit"]')?.textContent?.trim(),'提交');
 assert.equal(document.querySelector('[data-action="pair"]')?.textContent,'配对');
 assert.equal(document.querySelector('.language-badge')?.textContent,'C++');
 assert.equal(Boolean(document.querySelector('.connection small,.language,.empty-result')),false);
 assert.ok(document.querySelector('.katex'));assert.equal(document.querySelector('pre code')?.textContent,'int main() {}\n');
 assert.equal(document.querySelector('article img')?.getAttribute('src'),'https://assets.lanqiao.cn/a.png');
 assert.equal(document.querySelectorAll('h1').length,1);
});
test('不允许题面 HTML 注入按钮/脚本或命令链接，CSP 禁止页面连接',()=>{
 const output=html('<script>EVIL()</script>\n\n<button data-action="submit">BAD</button>\n\n[执行](command:workbench.action.terminal.new)\n\n[JS](javascript:alert(1))');
 const {document}=parseHTML(output);
 assert.equal(document.querySelectorAll('script').length,1);assert.equal(document.querySelectorAll('button[data-action="submit"]').length,1);
 assert.equal(document.querySelector('article script'),null);assert.equal(document.querySelector('a[href^="command:"]'),null);
 assert.ok(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes("connect-src 'none'"));
 assert.equal(document.querySelector('script')?.getAttribute('nonce'),'safe-nonce');
});
test('Webview 只能请求固定动作，不能指定另一题、路径、代码或任意命令',()=>{
 assert.equal(parsePreviewAction({action:'submit'}),'submit');assert.equal(parsePreviewAction({action:'sendToCph'}),'sendToCph');
 for(const value of [null,{},'submit',{action:'exec'},{action:'submit',file:'/tmp/other.cpp'},{action:'submit',problemId:'3009'},{action:'submit',code:'bad'},{action:'constructor'}])assert.equal(parsePreviewAction(value),undefined);
});
test('题面开始可复制 Markdown，每个代码样例有独立复制入口，按钮不混入样例',()=>{
 const {document}=parseHTML(html('## 样例输入\n\n```\n2024 124578\n```\n\n## 样例输出\n\n```\n145728\n```'));
 assert.equal(document.querySelector('[data-action="copyMarkdown"]')?.textContent,'复制题面 Markdown');
 assert.equal(document.querySelectorAll('article button[data-copy-block]').length,2);
 assert.equal(document.querySelector('article pre code')?.textContent,'2024 124578\n');
});
test('复制块与渲染顺序相同，引用块内样例、空格及空行原样保留',()=>{
 const markdown='> ```\n> 7\n> .......\n> \n> ```\n\n    1  2\n\n```cpp\ncout << "<x>";\n```';
 assert.deepEqual(markdownCodeBlocks(markdown),['7\n.......\n\n','1  2\n','cout << "<x>";\n']);
 const {document}=parseHTML(html(markdown));
 assert.deepEqual([...document.querySelectorAll('article button[data-copy-block]')].map(b=>b.getAttribute('data-copy-block')),['0','1','2']);
});
test('复制按钮位于代码框容器内；只隐藏生成的原题段落，保留其他链接与代码',()=>{
 const markdown='# 3008 特殊的三角形\n\n原题：[蓝桥 OJ 3008](https://www.lanqiao.cn/problems/3008/learning/)\n\n[参考](https://example.com)\n\n```\n原题：[蓝桥 OJ 3008](https://www.lanqiao.cn/problems/3008/learning/)\n```';
 const {document}=parseHTML(html(markdown));
 assert.equal(Boolean(document.querySelector('article > p a[href*="lanqiao.cn"]')),false);
 assert.ok(document.querySelector('[data-action="open"]'));
 assert.ok(document.querySelector('article a[href="https://example.com"]'));
 const block=document.querySelector('article .copy-block')!;
 assert.ok(block.querySelector('[data-copy-block]')?.parentElement===block);
 assert.match(block.querySelector('pre code')!.textContent!,/原题：/);
});
test('C 题面绑定 main.c 显示真实语言与切换入口',()=>{
 const {document}=parseHTML(renderProblemPreview(p,{nonce:'n',cspSource:'vscode-resource:',katexCss:'vscode-resource:/katex.css',source:'/tmp/3008/main.c'}));
 assert.equal(document.querySelector('[data-action="submit"]')?.textContent,'提交');assert.equal(document.querySelector('.language-badge')?.textContent,'C');assert.match(document.querySelector('.language-badge')!.getAttribute('title')!,/gcc8.3.0/);assert.ok(document.querySelector('[data-action="switchLanguage"]'));
 assert.equal(parsePreviewAction({action:'switchLanguage'}),'switchLanguage');assert.equal(parsePreviewAction({action:'switchLanguage',language:'python'}),undefined);
});
