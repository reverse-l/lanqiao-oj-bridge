import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp,readdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await mkdir('dist',{recursive:true});
await mkdir('artifacts',{recursive:true});
await mkdir('media/katex',{recursive:true});
await cp('node_modules/katex/dist/katex.min.css','media/katex/katex.min.css');
await cp('node_modules/katex/dist/fonts','media/katex/fonts',{recursive:true});
const notices=[];
for(const directory of execFileSync('npm',['ls','--all','--omit=dev','--parseable'],{encoding:'utf8'}).trim().split('\n').slice(1)){
 const pkg=JSON.parse(await readFile(`${directory}/package.json`,'utf8'));
 for(const name of await readdir(directory))if(/^(license|licence|copying)([. -]|$)/i.test(name)&&(await stat(`${directory}/${name}`)).isFile())notices.push(`# ${pkg.name} ${pkg.version}\n\n${await readFile(`${directory}/${name}`,'utf8')}`);
}
await writeFile('THIRD_PARTY_NOTICES.md',notices.join('\n\n').replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'').trimEnd()+'\n');
await build({entryPoints:['src/extension.ts'],outfile:'dist/extension.js',platform:'node',format:'cjs',target:'node20',bundle:true,external:['vscode']});
await build({entryPoints:['src/webview/main.ts'],outfile:'dist/preview-client.js',platform:'browser',format:'iife',target:'chrome110',bundle:true});
const header=`// ==UserScript==
// @name         Lanqiao OJ Bridge
// @namespace    https://github.com/epsilon-local/lanqiao-oj-bridge
// @version      0.4.0
// @author       reverse-l
// @license      MIT
// @homepageURL  https://github.com/reverse-l/lanqiao-oj-bridge
// @supportURL   https://github.com/reverse-l/lanqiao-oj-bridge/issues
// @downloadURL  https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js
// @description  蓝桥题面导入 VSCode、CPH 样例、官方在线调试和确认提交
// @match        https://www.lanqiao.cn/problems/*/learning/*
// @match        https://lanqiao.cn/problems/*/learning/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==`;
const turndownLicense=await readFile('node_modules/turndown/LICENSE','utf8');
await build({entryPoints:['src/browser/userscript.ts'],outfile:'dist/lanqiao-bridge.user.js',platform:'browser',format:'iife',target:'chrome110',bundle:true,banner:{js:header},legalComments:'none',footer:{js:`/*\nBundled Turndown license:\n${turndownLicense}\n*/`}});
await writeFile('artifacts/lanqiao-bridge.user.js',await readFile('dist/lanqiao-bridge.user.js'));
