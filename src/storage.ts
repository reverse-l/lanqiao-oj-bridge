import {lstat, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Problem,toCompanion,validateProblem} from './problem';
import {LanguageId,LANGUAGES,C_TEMPLATE,requireLanguage,languageOfSource,problemSourceName,type SourceFileNaming} from './languages';

export async function rejectSymlinks(target:string):Promise<void> {
 const absolute=path.resolve(target);let part=path.parse(absolute).root;
 for(const segment of absolute.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,segment);
  try{if((await lstat(part)).isSymbolicLink())throw new Error(`拒绝符号链接路径：${part}`);}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
}
async function createOnly(file:string,content:string){
 await rejectSymlinks(file);
 try{await writeFile(file,content,{flag:'wx',mode:0o600});return true;}
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e;}
}
export async function exportCompanion(value:Problem,source:string,target:string):Promise<string> {
 const p=validateProblem(value);source=path.resolve(source);target=path.resolve(target);
 if(!languageOfSource(source)||path.extname(target).toLowerCase()!=='.json')throw new Error('请选择 C / C++ 源码和 JSON 导出文件');
 await rejectSymlinks(source);await rejectSymlinks(target);
 if(!(await lstat(source)).isFile())throw new Error('导出对应源码文件不存在');
 const created=await createOnly(target,JSON.stringify(toCompanion(p,source),null,2)+'\n');
 if(!created)throw new Error('导出文件已存在，未覆盖；请使用其他文件名');
 return target;
}
export function cphFile(source:string,saveLocation=''){
 return path.join(saveLocation||path.join(path.dirname(source),'.cph'),`.${path.basename(source)}_${createHash('md5').update(source).digest('hex')}.prob`);
}
export async function ensureCphProblem(value:Problem,source:string,saveLocation='',previousSource=source){
 const p=validateProblem(value);source=path.resolve(source);await rejectSymlinks(source);
 if(!(await lstat(source)).isFile())throw new Error('CPH 对应源码文件不存在');
 const file=cphFile(source,saveLocation);await rejectSymlinks(file);await mkdir(path.dirname(file),{recursive:true});
 let content=JSON.stringify(toCompanion(p,source)),migratedFrom:string|undefined;
 // Windows 的盘符大小写影响 CPH 的 MD5 关联。只在新记录不存在时复制旧记录，旧文件始终保留。
 const candidates=new Set([previousSource,source.replace(/^([a-z]):(?=[\\/])/i,drive=>drive[0].toUpperCase()+':')]);
 let exists=false;try{await lstat(file);exists=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(!exists)for(const candidate of candidates){
  if(candidate===source)continue;
  const oldFile=cphFile(candidate,saveLocation);await rejectSymlinks(candidate);await rejectSymlinks(oldFile);
  try{
   const [oldStat,newStat]=await Promise.all([lstat(candidate),lstat(source)]);
   if(oldStat.dev!==newStat.dev||oldStat.ino!==newStat.ino)continue;
   const old=JSON.parse(await readFile(oldFile,'utf8'));
   if(old.srcPath!==candidate||!Array.isArray(old.tests))throw new Error(`旧 CPH 记录格式异常，请检查：${oldFile}`);
   content=JSON.stringify({...old,srcPath:source});migratedFrom=oldFile;break;
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 const created=await createOnly(file,content);
 return {path:file,created,migratedFrom:created?migratedFrom:undefined};
}
// 仅由用户明确确认的“恢复空样例”动作调用；常规发送仍只做独占创建。
export async function restoreEmptyCphProblem(value:Problem,source:string,saveLocation=''){
 const p=validateProblem(value),file=cphFile(path.resolve(source),saveLocation);await rejectSymlinks(file);
 const raw=await readFile(file,'utf8'),existing=JSON.parse(raw);
 if(!p.tests.length||!Array.isArray(existing.tests)||existing.tests.length)return {restored:false,path:file,backup:undefined};
 const backup=file+'.before-samples.bak';
 if(!await createOnly(backup,raw))throw new Error('旧样例备份已存在，请先检查备份，避免覆盖');
 if(await readFile(file,'utf8')!==raw)throw new Error('CPH 测试已被其他操作修改，取消恢复');
 await rejectSymlinks(file);await writeFile(file,JSON.stringify({...existing,tests:toCompanion(p,source).tests}));
 return {restored:true,path:file,backup};
}
export async function findProblemSource(directory:string,id:string,language:LanguageId,existingSource?:string):Promise<string|undefined> {
 const recorded=existingSource&&path.isAbsolute(existingSource)&&path.relative(directory,path.dirname(existingSource))===''&&languageOfSource(existingSource)===language
  ?existingSource:undefined;
 const candidates=new Set([recorded,path.join(directory,LANGUAGES[language].fileName),path.join(directory,problemSourceName(id,language))]);
 for(const file of candidates){
  if(!file)continue;
  await rejectSymlinks(file);
  try{if((await lstat(file)).isFile())return file;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
}
async function recordedProblemDirectory(source:string|undefined,id:string):Promise<string|undefined> {
 if(!source||!path.isAbsolute(source)||!languageOfSource(source))return;
 const directory=path.dirname(source),metadata=path.join(directory,'.lanqiao.json');
 try{
  await rejectSymlinks(source);await rejectSymlinks(metadata);
  if((await lstat(source)).isFile()&&validateProblem(JSON.parse(await readFile(metadata,'utf8'))).id===id)return directory;
 }catch{ /* An unavailable association should use the configured import root. */ }
}
interface ImportSourceOptions {naming?:SourceFileNaming;existingSource?:string}
export async function importProblem(root:string,template:string,value:Problem,cphLocation='',language:LanguageId='cpp',
 sourceIdentity:(source:string)=>string|Promise<string>=source=>source,options:ImportSourceOptions={}) {
 language=requireLanguage(language);
 const p=validateProblem(value);
 const recordedDirectory=await recordedProblemDirectory(options.existingSource,p.id);
 let directory=recordedDirectory;
 if(!directory){
  root=path.resolve(root);await rejectSymlinks(root);await mkdir(root,{recursive:true});
  const entries=(await readdir(root)).filter(n=>n.startsWith(`${p.id}-`));
  if(entries.length>1) throw new Error(`题号 ${p.id} 对应多个目录，请手动整理后重试`);
  const title=p.title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/^\.+|\.+$/g,'_').slice(0,90)||'题目';
  directory=path.join(root,entries[0]||`${p.id}-${title}`);
  await rejectSymlinks(directory);await mkdir(directory,{recursive:true});
 }
 const existing=await findProblemSource(directory,p.id,language,recordedDirectory?options.existingSource:undefined);
 const originalSource=existing??path.join(directory,problemSourceName(p.id,language,options.naming));
 const created=!existing&&await createOnly(originalSource,language==='c'&&!template?C_TEMPLATE:await readFile(template,'utf8'));
 const source=await sourceIdentity(originalSource);await rejectSymlinks(source);
 const markdownPath = path.join(directory, 'README.md');
 await createOnly(markdownPath,p.markdown);
 await createOnly(path.join(directory,'.lanqiao.json'),JSON.stringify(p,null,2)+'\n');
 const samples=path.join(directory,'samples');await rejectSymlinks(samples);await mkdir(samples,{recursive:true});
 for(const [i,t] of p.tests.entries()) {await createOnly(path.join(samples,`${i+1}.in`),t.input);await createOnly(path.join(samples,`${i+1}.out`),t.output);}
 const {path:cphPath}=await ensureCphProblem(p,source,cphLocation,originalSource);
 return {directory,source,markdownPath,cphPath,created,samples:p.tests.length};
}
