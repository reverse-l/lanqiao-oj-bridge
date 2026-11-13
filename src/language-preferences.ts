import type {LanguageId} from './languages';
interface State {get(key:string):unknown;update(key:string,value:unknown):PromiseLike<void>}
export class LanguagePreferences {
 private pending=Promise.resolve();
 constructor(private state:State,private defaultLanguage:()=>LanguageId,private saveDefault:(language:LanguageId)=>PromiseLike<void>){}
 private read():Record<string,LanguageId>{
  const value=this.state.get('problem.languages');
  return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([id,language])=>/^\d{1,10}$/.test(id)&&(language==='c'||language==='cpp'))):{};
 }
 forProblem(id:string):LanguageId{return this.read()[id]||this.defaultLanguage();}
 rememberProblem(id:string,language:LanguageId):Promise<void>{
  if(!/^\d{1,10}$/.test(id)||!['c','cpp'].includes(language))return Promise.reject(new Error('无效的题目语言偏好'));
  this.pending=this.pending.catch(()=>{}).then(async()=>{
   const saved=this.read();if(saved[id]===language)return;
   delete saved[id];saved[id]=language;
   await this.state.update('problem.languages',saved);
  });return this.pending;
 }
 async choose(id:string,language:LanguageId):Promise<void>{
  await this.saveDefault(language);await this.rememberProblem(id,language);
 }
}
