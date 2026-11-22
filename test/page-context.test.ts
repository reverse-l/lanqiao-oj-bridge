import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {resolvePageContext} from '../src/browser/page-context';

function page(url:string,env:any={}) {
 const {document}=parseHTML('<div class="online-judge-env"></div>');
 (document.querySelector('.online-judge-env') as any).__vue__=env;
 return {document,location:new URL(url)} as unknown as Window;
}
function course(){return {labId:700001,problemId:2942,ojLab:{lab:{id:700001},problem_id:2942},labModel:{isOjLab:true,isContest:false,lab:{id:700001},course:{id:71},ojLab:{lab:{id:700001},problem_id:2942}}};}
const url='https://www.lanqiao.cn/courses/71/learning/?id=700001&compatibility=false';
test('课程单元映射到真实 OJ 题号，规范链接按题号生成而不是 lab 编号',()=>{
 const context=resolvePageContext(page(url,course()));
 assert.equal(context?.id,'2942');assert.equal(context?.labId,'700001');assert.equal(context?.kind,'course');
 assert.equal(context?.url,'https://www.lanqiao.cn/problems/2942/learning/');assert.match(context!.key,/71.*700001/);
 assert.equal(context?.courseUrl,'https://www.lanqiao.cn/courses/71/learning/?id=700001');
});
test('普通题目保留兼容，已加载的编辑器题号必须与地址一致',()=>{
 assert.equal(resolvePageContext(page('https://lanqiao.cn/problems/3008/learning/',{labId:3008}))?.id,'3008');
 assert.equal(resolvePageContext(page('https://lanqiao.cn/problems/3008/learning/',{labId:3009})),undefined);
 for(const u of ['https://example.com/problems/3008/learning/','https://user@www.lanqiao.cn/problems/3008/learning/','http://www.lanqiao.cn/problems/3008/learning/'])assert.equal(resolvePageContext(page(u)),undefined);
});
test('课程切换、非 OJ、映射缺失或冲突时不猜题号',()=>{
 for(const mutate of [
  (e:any)=>{e.labId=700002;},(e:any)=>{e.ojLab=null;},(e:any)=>{e.labModel.isOjLab=false;},
  (e:any)=>{e.ojLab.lab.id=5;},(e:any)=>{e.labModel.ojLab.problem_id=99;},
  (e:any)=>{e.labModel.lab.id=2;},(e:any)=>{e.labModel.course.id=3;},(e:any)=>{e.problemId=99;}
 ]){const e=course();mutate(e);assert.equal(resolvePageContext(page(url,e)),undefined);}
 assert.equal(resolvePageContext(page(url.replace('700001','700002'),course())),undefined);
 assert.equal(resolvePageContext(page(url.replace('id=700001','id=bad'),course())),undefined);
});
