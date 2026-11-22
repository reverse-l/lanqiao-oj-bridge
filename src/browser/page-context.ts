import {OFFICIAL_ORIGINS} from '../problem';

export interface PageContext {kind:'problem'|'course';id:string;key:string;url:string;labId?:string;courseUrl?:string}
const numeric=(value:unknown):string|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^\d{1,10}$/.test(value)?String(value):undefined;

// 与平台编辑器适配一样只读取当前组件的业务字段，不读取登录存储，也不请求其他单元。
// 已核对官方 v7.52.19: online-judge-env.labId / ojLab.problem_id / labModel.ojLab。
export function resolvePageContext(page:Window):PageContext|undefined {
 let u:URL;try{u=new URL(page.location.href);}catch{return;}
 if(!OFFICIAL_ORIGINS.has(u.origin)||u.username||u.password)return;
 const env=(page.document.querySelector('.online-judge-env') as any)?.__vue__;
 const ordinary=u.pathname.match(/^\/problems\/(\d{1,10})\/learning\/?$/);
 if(ordinary){
  const id=ordinary[1];
  if(env?.labId!==undefined&&numeric(env.labId)!==id||env?.problemId!==undefined&&numeric(env.problemId)!==id)return;
  return {kind:'problem',id,key:`problem:${id}`,url:`${u.origin}/problems/${id}/learning/`};
 }
 const course=u.pathname.match(/^\/courses\/(\d{1,10})\/learning\/?$/),labId=numeric(u.searchParams.get('id'));
 if(!course||!labId||!env)return;
 const model=env.labModel,oj=env.ojLab,id=numeric(oj?.problem_id);
 if(!id||model?.isOjLab!==true||model?.isContest===true||numeric(env.labId)!==labId||numeric(model.lab?.id)!==labId||numeric(oj.lab?.id)!==labId)return;
 if(numeric(model.ojLab?.problem_id)!==id||numeric(model.ojLab?.lab?.id)!==labId)return;
 if(env.problemId!==undefined&&numeric(env.problemId)!==id||model.course?.id!==undefined&&numeric(model.course.id)!==course[1])return;
 return {
  kind:'course',id,labId,key:`course:${course[1]}:${labId}:${id}`,
  url:`${u.origin}/problems/${id}/learning/`,courseUrl:`${u.origin}/courses/${course[1]}/learning/?id=${labId}`,
 };
}
