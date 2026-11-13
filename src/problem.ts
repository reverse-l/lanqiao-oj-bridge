import TurndownService from 'turndown';
import {SampleCollector} from './sample-collector';
import {LanguageId,languageOfSource} from './languages';

export interface Sample { input:string; output:string }
export interface Problem {
 version:1; id:string; title:string; url:string; markdown:string; tests:Sample[];
 timeLimit?:number; memoryLimit?:number;
 limits?:Partial<Record<LanguageId,{timeLimit?:number;memoryLimit?:number}>>;
}
export const OFFICIAL_ORIGINS = new Set(['https://www.lanqiao.cn','https://lanqiao.cn']);
export function problemId(url:string):string {
 const u=new URL(url); const match=u.pathname.match(/^\/problems\/(\d+)\/(?:learning\/?)?$/);
 if(!OFFICIAL_ORIGINS.has(u.origin)||u.username||u.password||!match) throw new Error('不是受支持的蓝桥题目 URL');
 return match[1];
}
export function validateProblem(value:unknown):Problem {
 const p=value as Problem;
 if(!p||p.version!==1||typeof p.id!=='string'||!/^\d{1,10}$/.test(p.id)||typeof p.url!=='string'||problemId(p.url)!==p.id) throw new Error('题号或 URL 无效');
 if(typeof p.title!=='string'||!p.title.trim()||p.title.length>200||typeof p.markdown!=='string'||p.markdown.length>2_000_000) throw new Error('题面数据无效或过大');
 if(!Array.isArray(p.tests)||p.tests.length>100||p.tests.some(t=>!t||typeof t.input!=='string'||typeof t.output!=='string'||t.input.length>600_000||t.output.length>600_000)) throw new Error('样例数据无效或过大');
 for(const limit of [p.timeLimit,p.memoryLimit]) if(limit!==undefined&&(!Number.isFinite(limit)||limit<=0||limit>1e9)) throw new Error('运行限制无效');
 const limits:Problem['limits']={};
 if(p.limits!==undefined){
  if(!p.limits||typeof p.limits!=='object'||Array.isArray(p.limits))throw new Error('语言运行限制无效');
  for(const language of ['cpp','c'] as const){const value=p.limits[language];if(value===undefined)continue;
   if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('语言运行限制无效');
   for(const limit of [value.timeLimit,value.memoryLimit])if(limit!==undefined&&(!Number.isFinite(limit)||limit<=0||limit>1e9))throw new Error('语言运行限制无效');
   limits[language]={...(value.timeLimit?{timeLimit:value.timeLimit}:{}),...(value.memoryLimit?{memoryLimit:value.memoryLimit}:{})};
  }
 }
 return {version:1,id:p.id,title:p.title.trim(),url:p.url,markdown:p.markdown,tests:p.tests.map(t=>({input:t.input,output:t.output})),...(p.timeLimit?{timeLimit:p.timeLimit}:{}),...(p.memoryLimit?{memoryLimit:p.memoryLimit}:{}),...(Object.keys(limits).length?{limits}:{})};
}
export function parseProblem(doc:Document,url:string):Problem {
 const id=problemId(url), source=doc.querySelector('.markdown-body'), title=doc.querySelector('.course-name')?.textContent?.replace(/^\s*\d+\s*[.、．]\s*/,'').trim();
 if(!source||!title||!source.querySelector('h1,h2,h3,h4')) throw new Error('题面未加载、登录失效或页面结构已变化，请等待页面加载后重试');
 const body=source.cloneNode(true) as HTMLElement;
 body.querySelectorAll('script,style,iframe,object,embed,form,.btn-copy,.katex-html').forEach(e=>e.remove());
 body.querySelectorAll('.katex').forEach(e=>{
  const tex=e.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if(tex){const block=e.parentElement?.classList.contains('katex-display'); e.textContent=block?`\n$$\n${tex}\n$$\n`:`$${tex}$`;}
 });
 body.querySelectorAll('img,a').forEach(e=>{
  const attr=e.tagName.toLowerCase()==='img'?'src':'href';
  try {const u=new URL(e.getAttribute(attr)||'',url); if(!['https:','http:'].includes(u.protocol)) e.remove();else e.setAttribute(attr,u.href);}
  catch {e.remove();}
 });
 const collector=new SampleCollector();
 for(const e of body.children){
  if(/^H[1-6]$/.test(e.tagName)){
   collector.heading(e.textContent||'',Number(e.tagName.slice(1)));
  } else {
   if(e.tagName==='BLOCKQUOTE'||e.tagName==='P')collector.label(e.textContent||'');
   const codes=e.tagName==='PRE'?[e.querySelector('code')||e]:[...e.querySelectorAll('pre > code')];
   for(const code of codes)collector.code(code.textContent||'');
  }
 }
 const tests=collector.finish();
 const turndown=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',emDelimiter:'*'});
 turndown.addRule('table',{filter:'table',replacement:(_content,node)=>{
  const descendants=(n:Node,tags:string[]):Node[]=>Array.from(n.childNodes).flatMap(c=>tags.includes(c.nodeName)?[c]:descendants(c,tags));
  const rows=descendants(node as unknown as Node,['TR']).map(r=>descendants(r,['TH','TD']).map(c=>(c.textContent||'').trim().replace(/\|/g,'\\|').replace(/\n/g,' ')));
  if(!rows.length)return '';return '\n\n'+[rows[0],rows[0].map(()=>'---'),...rows.slice(1)].map(r=>'| '+r.join(' | ')+' |').join('\n')+'\n\n';
 }});
 // KaTeX 已化为纯文本，避免 Turndown 把公式中的下划线转义。
 const formulas:string[]=[];
 body.querySelectorAll('.katex').forEach(e=>{formulas.push(e.textContent||'');e.textContent=`LQFORMULA${formulas.length-1}TOKEN`;});
 let markdown=turndown.turndown(body.outerHTML).replace(/LQFORMULA(\d+)TOKEN/g,(_,i)=>formulas[Number(i)]);
 const limits:Problem['limits']={};
 for(const row of source.querySelectorAll('tr')){
  const cells=[...row.querySelectorAll('td')].map(e=>(e.textContent||'').trim());
  const language=cells[0]==='C++'?'cpp':cells[0]==='C'?'c':undefined;if(!language)continue;
  const time=cells[1]?.match(/([\d.]+)\s*(ms|s)/),memory=cells[2]?.match(/([\d.]+)\s*M/i);
  limits[language]={...(time?{timeLimit:Number(time[1])*(time[2]==='s'?1000:1)}:{}),...(memory?{memoryLimit:Number(memory[1])}:{})};
 }
 markdown=`# ${id} ${title}\n\n原题：[蓝桥 OJ ${id}](${url})\n\n${markdown}\n`;
 return validateProblem({version:1,id,title,url,markdown,tests,...limits.cpp,limits});
}
export function toCompanion(p:Problem,srcPath:string) {
 const limits=languageOfSource(srcPath)==='c'?p.limits?.c:p.limits?.cpp||{timeLimit:p.timeLimit,memoryLimit:p.memoryLimit};
 return {name:`${p.id}. ${p.title}`,group:'Lanqiao',url:p.url,interactive:false,...(limits?.timeLimit?{timeLimit:limits.timeLimit}:{}),...(limits?.memoryLimit?{memoryLimit:limits.memoryLimit}:{}),tests:p.tests.map((t,i)=>({...t,id:Date.now()+i})),testType:'single',input:{type:'stdin'},output:{type:'stdout'},languages:{java:{mainClass:'Main',taskClass:'Task'}},batch:{id:`lanqiao-${p.id}`,size:1},srcPath};
}
