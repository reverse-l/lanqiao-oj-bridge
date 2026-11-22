export type ExcludeRule=boolean|{when:string};
export type ExcludeRules=Record<string,ExcludeRule>;
export type PreviousRules=Record<string,ExcludeRule|null>;

export function cleanPatterns(relativeRoot:string,platform:'win32'|'posix'=process.platform==='win32'?'win32':'posix'):string[] {
 if(platform==='posix'&&relativeRoot.includes('\\'))throw new Error('当前工作区路径含字面反斜杠，无法安全生成隐藏规则；请使用不含反斜杠的题目目录。未修改设置。');
 const root=platform==='win32'?relativeRoot.replace(/\\/g,'/'):relativeRoot;
 if(root.startsWith('/')||/^[a-z]:/i.test(root)||root.split('/').includes('..'))throw new Error('题目目录必须在当前工作区文件夹内');
 // files.exclude 使用 VSCode glob；特殊字符按单字符范围转义。
 const escaped=root.split('/').filter(s=>s&&s!=='.').map(s=>s.replace(/[\[\]{}*?]/g,c=>`[${c}]`)).join('/');
 const prefix=(escaped?escaped+'/':'')+'*/';
 return ['.cph','.lanqiao.json','companion.json','companion.cpp.json','companion.c.json','main.bin','main.exe'].map(name=>prefix+name);
}
export function hideInternalFiles(current:ExcludeRules,patterns:readonly string[],previous:PreviousRules):{next:ExcludeRules;previous:PreviousRules} {
 const next={...current},saved={...previous};
 for(const pattern of patterns){
  if(next[pattern]===true)continue;
  if(!Object.hasOwn(saved,pattern))saved[pattern]=Object.hasOwn(current,pattern)?current[pattern]:null;
  next[pattern]=true;
 }
 return {next,previous:saved};
}
export function restoreInternalFiles(current:ExcludeRules,previous:PreviousRules):ExcludeRules {
 const next={...current};
 for(const [pattern,value] of Object.entries(previous)){
  if(next[pattern]!==true)continue; // 启用后用户自行修改的值优先，不覆盖。
  if(value===null)delete next[pattern];else next[pattern]=value;
 }
 return next;
}
