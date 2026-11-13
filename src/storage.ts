import {lstat, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Problem,toCompanion,validateProblem} from './problem';
import {LanguageId,LANGUAGES,C_TEMPLATE,requireLanguage} from './languages';

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
export function cphFile(source:string,saveLocation=''){
 return path.join(saveLocation||path.join(path.dirname(source),'.cph'),`.${path.basename(source)}_${createHash('md5').update(source).digest('hex')}.prob`);
}
export async function ensureCphProblem(value:Problem,source:string,saveLocation=''){
 const p=validateProblem(value);source=path.resolve(source);await rejectSymlinks(source);
 if(!(await lstat(source)).isFile())throw new Error('CPH 对应源码文件不存在');
 const file=cphFile(source,saveLocation);await rejectSymlinks(file);await mkdir(path.dirname(file),{recursive:true});
 const created=await createOnly(file,JSON.stringify(toCompanion(p,source)));
 return {path:file,created};
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
export async function importProblem(root:string,template:string,value:Problem,cphLocation='',language:LanguageId='cpp') {
 language=requireLanguage(language);
 const p=validateProblem(value);root=path.resolve(root);await rejectSymlinks(root);await mkdir(root,{recursive:true});
 const entries=(await readdir(root)).filter(n=>n.startsWith(`${p.id}-`));
 if(entries.length>1) throw new Error(`题号 ${p.id} 对应多个目录，请手动整理后重试`);
 const title=p.title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/^\.+|\.+$/g,'_').slice(0,90)||'题目';
 const directory=path.join(root,entries[0]||`${p.id}-${title}`);await rejectSymlinks(directory);await mkdir(directory,{recursive:true});
 const source=path.join(directory,LANGUAGES[language].fileName);
 await rejectSymlinks(source);
 let exists=false;try{await lstat(source);exists=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const created=exists?false:await createOnly(source,language==='c'&&!template?C_TEMPLATE:await readFile(template,'utf8'));
 await createOnly(path.join(directory,'README.md'),p.markdown);
 await createOnly(path.join(directory,'.lanqiao.json'),JSON.stringify(p,null,2)+'\n');
 await createOnly(path.join(directory,'companion.json'),JSON.stringify(toCompanion(p,source),null,2)+'\n');
 await createOnly(path.join(directory,`companion.${language}.json`),JSON.stringify(toCompanion(p,source),null,2)+'\n');
 const samples=path.join(directory,'samples');await rejectSymlinks(samples);await mkdir(samples,{recursive:true});
 for(const [i,t] of p.tests.entries()) {await createOnly(path.join(samples,`${i+1}.in`),t.input);await createOnly(path.join(samples,`${i+1}.out`),t.output);}
 const {path:cphPath}=await ensureCphProblem(p,source,cphLocation);
 return {directory,source,cphPath,created,samples:p.tests.length};
}
