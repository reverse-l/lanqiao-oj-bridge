import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import type {Problem} from './problem';
import type {ConnectionState} from './connection';
import type {SavedJob} from './result-card';
import {renderResultCard} from './result-card';
import {COPY_ICON} from './copy-icon';
import {LANGUAGES,languageOfSource,sourceName} from './languages';

export const PREVIEW_ACTIONS=['sendToCph','localTest','debug','submit','recent','open','check','pair','copyOutput','copyError','copyId','copyMarkdown','switchLanguage'] as const;
export type PreviewAction=typeof PREVIEW_ACTIONS[number];
export function parsePreviewAction(value:unknown):PreviewAction|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1)return;
 const action=(value as {action?:unknown}).action;
 return typeof action==='string'&&(PREVIEW_ACTIONS as readonly string[]).includes(action)?action as PreviewAction:undefined;
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function markdownCodeBlocks(markdown:string):string[]{return new MarkdownIt().parse(markdown,{}).filter(t=>t.type==='fence'||t.type==='code_block').map(t=>t.content);}
export interface PreviewResources {nonce:string;cspSource:string;katexCss:string;clientJs?:string;source?:string;scrollY?:number;connection?:ConnectionState;job?:SavedJob;imageUri?:(src:string)=>string}
export function renderProblemPreview(p:Problem,resources:PreviewResources):string {
 const language=languageOfSource(resources.source||'')||'cpp',profile=LANGUAGES[language],fileName=sourceName(resources.source||profile.fileName);
 const md=new MarkdownIt({html:false,linkify:false,typographer:false}).use(markdownItKatex,{throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,maxSize:20});
 md.validateLink=(link:string)=>/^(https?:\/\/|#)/i.test(link);
 let blockIndex=0;
 for(const type of ['fence','code_block']){
  const original=md.renderer.rules[type]!;
  md.renderer.rules[type]=(tokens,index,options,env,self)=>`<div class="copy-block"><button type="button" class="copy-button" data-copy-block="${blockIndex++}" aria-label="复制此代码块或样例" title="复制">${COPY_ICON}</button>${original(tokens,index,options,env,self)}</div>`;
 }
 const image=md.renderer.rules.image!;
 md.renderer.rules.image=(tokens,index,options,env,self)=>{
  const token=tokens[index],src=String(token.attrGet('src')||'');
  if(resources.imageUri&&!/^[a-z][\w+.-]*:/i.test(src))token.attrSet('src',resources.imageUri(src));
  if(!/^(https?:\/\/|vscode-resource:)/i.test(String(token.attrGet('src')||'')))return escape(token.content);
  return image(tokens,index,options,env,self);
 };
 const markdown=p.markdown.replace(/^\s*# [^\n]+\n/,'');
 const tokens=md.parse(markdown,{});
 // 只隐藏工具生成的独立来源段落；README 与复制的完整 Markdown 保留来源。
 const source=tokens.findIndex((t,i)=>t.type==='paragraph_open'&&t.level===0&&tokens[i+1]?.type==='inline'&&tokens[i+1].content.trim()===`原题：[蓝桥 OJ ${p.id}](${p.url})`&&tokens[i+2]?.type==='paragraph_close');
 if(source>=0)tokens.splice(source,3);
 const content=md.renderer.render(tokens,md.options,{});
 return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escape(resources.cspSource)} https: http:; style-src ${escape(resources.cspSource)} 'unsafe-inline'; font-src ${escape(resources.cspSource)}; script-src 'nonce-${escape(resources.nonce)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="${escape(resources.katexCss)}"><title>${escape(p.id+' '+p.title)}</title>
<style>
.statement-tools{margin:12px 0}.statement-tools button{font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:1px solid var(--vscode-panel-border);border-radius:3px;padding:4px 10px;cursor:pointer}
.connection{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;margin-bottom:14px}.connection small{flex-basis:100%;color:var(--vscode-descriptionForeground)}.connection strong{border:1px solid var(--vscode-panel-border);padding:3px 8px;border-radius:10px}.result-card{border:1px solid var(--vscode-panel-border);border-radius:5px;margin:12px 0 22px;padding:14px;font-size:13px}.result-heading{display:flex;flex-wrap:wrap;align-items:center;gap:9px}.verdict{font-weight:bold;color:var(--vscode-textLink-foreground);margin-left:auto}.result-date,.empty-result{color:var(--vscode-descriptionForeground);font-size:12px}.metrics{display:flex;flex-wrap:wrap;gap:24px}.metrics dd{margin:0}.metrics dt{color:var(--vscode-descriptionForeground)}details{margin-top:10px}summary{cursor:pointer}details pre{max-height:280px;white-space:pre;overflow:auto}.result-card button,.connection button{font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:0;border-radius:3px;padding:4px 9px;cursor:pointer}.platform-message{white-space:pre-wrap}
body{color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family);font-size:15px;line-height:1.75;padding:22px 26px 70px;max-width:1000px;margin:auto;overflow-wrap:anywhere}
h1{font-size:30px;line-height:1.35;margin:0 0 18px;font-weight:650}h1 .number{color:var(--vscode-textLink-foreground);margin-right:9px}.toolbar{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 10px}.toolbar button{font:inherit;line-height:1.45;padding:8px 14px;border:1px solid transparent;border-radius:3px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.toolbar button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.toolbar button:hover{filter:brightness(1.08)}button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.toolbar button:disabled{opacity:.55;cursor:wait}.language{font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 16px}.status{white-space:pre-wrap;max-height:300px;overflow:auto;margin:0 0 20px;padding:9px 12px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);font-size:13px}.status:empty{display:none}hr{border:0;border-top:1px solid var(--vscode-panel-border);margin:20px 0}h2,h3{line-height:1.5;margin-top:26px}a{color:var(--vscode-textLink-foreground)}pre{padding:14px 16px;background:var(--vscode-textCodeBlock-background);overflow:auto;border-radius:4px;overflow-wrap:normal}code{font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid var(--vscode-panel-border);padding:6px 12px}img{max-width:100%}.katex{font-size:1.08em}.katex-display{overflow-x:auto;overflow-y:hidden;padding:6px 0}blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:12px} @media(max-width:550px){body{padding:16px}h1{font-size:24px}.toolbar button{padding:7px 10px}}
.copy-block{position:relative;margin:14px 0}.copy-block pre{margin:0;padding-right:54px;min-height:24px}.copy-block .copy-button{position:absolute;z-index:1;top:7px;right:7px;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:4px;border:1px solid transparent;border-radius:4px;background:var(--vscode-textCodeBlock-background);color:var(--vscode-editor-foreground);cursor:pointer;opacity:0;pointer-events:none}.copy-block:hover .copy-button,.copy-block:focus-within .copy-button{opacity:1;pointer-events:auto}.copy-block .copy-button:hover{border-color:var(--vscode-focusBorder)}.copy-button svg{pointer-events:none}@media(hover:none){.copy-block .copy-button{opacity:1;pointer-events:auto}}
</style></head><body data-preview="${escape(JSON.stringify({version:1,source:resources.source||'',scrollY:resources.scrollY||0}))}">
<header><h1><span class="number">${escape(p.id)}</span>${escape(p.title)}</h1>
<div id="connection" class="connection" role="status"><strong>${escape(resources.connection?.label||'等待网页连接')}</strong><button data-action="check">重新检测</button><button data-action="pair">配对 / 脚本</button><small>${escape(resources.connection?.detail||'正在检测本题浏览器连接…')}</small></div>
<nav id="controls" class="toolbar" aria-label="题目操作">
<button type="button" class="primary" data-action="sendToCph">发送至 CPH</button>
<button type="button" data-action="localTest">本地测试</button>
<button type="button" data-action="debug" ${resources.connection?.canRunOnline?'':'disabled'}>OJ 在线调试</button>
<button type="button" class="primary" data-action="submit" ${resources.connection?.canRunOnline?'':'disabled'}>提交 ${escape(fileName)}</button>
<button type="button" data-action="switchLanguage">切换语言</button>
<button type="button" data-action="recent">查看评测</button>
<button type="button" data-action="open">打开原题</button>
</nav><p class="language">在线：${escape(profile.officialLabel)}　·　本地：现有 CPH ${escape(profile.label)} 配置　·　提交文件：${escape(fileName)}</p>
<div id="status" class="status" role="status" aria-live="polite"></div><div id="result">${renderResultCard(resources.job)}</div><hr></header>
<div class="statement-tools"><button type="button" data-action="copyMarkdown">复制题面 Markdown</button></div><article>${content}</article>
<script nonce="${escape(resources.nonce)}" src="${escape(resources.clientJs||'vscode-resource:/preview-client.js')}"></script></body></html>`;
}
