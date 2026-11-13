import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderResultCard,recoverHistory} from '../src/result-card';
test('官方自测与正式提交分开标注；只展示真实数据且保留零',()=>{
 const j={id:'one',kind:'debug' as const,problemId:'3008',state:'finished' as const,created:1,result:{phase:'done' as const,status:'WA',stdout:'0\n1\n',runtime:0,testCases:[{result:'AC',millisecond:12,memory:256}]}};
 const {document}=parseHTML(renderResultCard(j));
 assert.match(document.querySelector('section')!.textContent!,/官方在线自测/);
 assert.doesNotMatch(document.querySelector('.verdict')!.textContent!,/WA/);
 assert.match(document.querySelector('[data-field="runtime"]')!.textContent!,/0/);
 assert.equal(document.querySelector('[data-field="memory"]')!.textContent,'未提供');
 assert.equal(document.querySelector('pre')!.textContent,'0\n1\n');
 assert.match(renderResultCard({...j,kind:'submit'}),/正式提交/);
});
test('输入调试不显示题目评测结论；官方调试与正式提交仍保留原值',()=>{
 const job={id:'x',kind:'debug' as const,debugMode:'input' as const,problemId:'21711',state:'finished' as const,created:1,result:{phase:'done' as const,status:'WA',message:'答案错误',stdout:'145728\n',passRate:0,testCases:[{result:'答案错误'}]}};
 assert.doesNotMatch(renderResultCard(job),/WA|答案错误|通过率|官方测试点/);
 assert.match(renderResultCard({...job,debugMode:'official'}),/WA/);
 assert.match(renderResultCard({...job,kind:'submit'}),/WA/);
});
test('运行输出复制图标与输出框放在同一容器，复制按钮文字不混入输出',()=>{
 const {document}=parseHTML(renderResultCard({id:'x',kind:'debug',problemId:'21711',created:1,state:'finished',result:{phase:'done',stdout:'145728\n'}}));
 const button=document.querySelector('[data-action="copyOutput"]')!;
 assert.equal(button.parentElement?.className,'copy-block');
 assert.equal(button.parentElement?.querySelector('pre')?.textContent,'145728\n');
 assert.equal(button.getAttribute('aria-label'),'复制标准输出');
});
test('中间阶段或未知结果不显示成功结论，输出不能注入 HTML',()=>{
 const html=renderResultCard({id:'x',kind:'submit',problemId:'178',created:1,state:'finished',result:{phase:'unknown',status:'AC',stderr:'\u001b[31m<script>alert(1)</script>\u001b[0m'}});
 const {document}=parseHTML(html);
 assert.match(document.querySelector('.verdict')!.textContent!,/结果未知/);
 assert.doesNotMatch(document.querySelector('.verdict')!.textContent!,/AC/);
 assert.equal(document.querySelector('script'),null);assert.ok(!html.includes('\u001b'));
 assert.match(document.querySelector('section')!.textContent!,/官方记录/);
});
test('恢复未完成历史不重新提交，清除代码并明确未知/未发送',()=>{
 const result=recoverHistory([{id:'x',kind:'submit',problemId:'3008',created:1,state:'claimed',code:'SECRET',input:'stdin',result:{phase:'accepted',submissionId:'real'}},{id:'y',kind:'debug',problemId:'178',created:2,state:'queued'}]);
 assert.equal(result[0].result?.phase,'unknown');assert.equal(result[0].result?.submissionId,'real');
 assert.equal(result[1].result?.phase,'error');assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('未持有服务的第二窗口不能把另一窗口的活动请求标为取消',()=>{
 const history=[{id:'active',kind:'submit',problemId:'3008',created:1,state:'queued',code:'SECRET'}];
 const readOnly=recoverHistory(history,false);
 assert.equal(readOnly[0].state,'queued');assert.equal(readOnly[0].result,undefined);
 assert.ok(!JSON.stringify(readOnly).includes('SECRET'));
});
