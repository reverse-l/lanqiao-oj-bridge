import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanPatterns,hideInternalFiles,restoreInternalFiles} from '../src/explorer-layout';

test('显示规则只覆盖蓝桥根目录下的内部文件，源码题面和样例保持可见',()=>{
 const patterns=cleanPatterns('Algorithm/Lanqiao');
 assert.ok(patterns.includes('Algorithm/Lanqiao/*/.cph'));assert.ok(patterns.includes('Algorithm/Lanqiao/*/main.bin'));
 assert.ok(patterns.includes('Algorithm/Lanqiao/*/main.exe'));assert.equal(patterns.length,7);
 assert.ok(patterns.every(p=>p.startsWith('Algorithm/Lanqiao/*/')));assert.ok(patterns.every(p=>!p.endsWith('main.cpp')&&!p.endsWith('README.md')&&!p.endsWith('samples')));
 assert.equal(cleanPatterns('')[0],'*/.cph');assert.equal(cleanPatterns('Algorithm\\Lanqiao','win32')[0],'Algorithm/Lanqiao/*/.cph');
});
test('POSIX 的字面反斜杠目录不能被误识别为另一个嵌套目录',()=>{
 assert.throws(()=>cleanPatterns('Lanqiao\\backup','posix'),/工作区.*反斜杠/);
 assert.equal(cleanPatterns('Lanqiao/backup','posix')[0],'Lanqiao/backup/*/.cph');
});
test('特殊目录名转义；绝对路径和父目录不能变成广泛隐藏规则',()=>{
 assert.equal(cleanPatterns('课题[1]/{test}*?')[0],'课题[[]1[]]/[{]test[}][*][?]/*/.cph');
 for(const p of ['../outside','Lanqiao/../outside','/Users/test','C:\\Code\\Lanqiao'])assert.throws(()=>cleanPatterns(p),/工作区/);
});
test('规则合并保留用户原设置，重复启用不丢失最初快照',()=>{
 const patterns=cleanPatterns('Lanqiao'),key=patterns[0],second=patterns[1];
 const original={'**/.git':true,[key]:false,[second]:{when:'$(basename).cpp'}};
 const enabled=hideInternalFiles(original,patterns,{}),again=hideInternalFiles(enabled.next,patterns,enabled.previous);
 assert.deepEqual(again,enabled);assert.equal(again.next['**/.git'],true);
 const restored=restoreInternalFiles(again.next,again.previous);assert.deepEqual(restored,original);
});
test('恢复时保留用户后续修改的规则，不取消用户原本已有的隐藏规则',()=>{
 const patterns=cleanPatterns('Lanqiao'),[key,second,third]=patterns;
 const enabled=hideInternalFiles({[key]:true},patterns,{});
 const current={...enabled.next,[second]:false,[third]:{when:'new-setting'},'**/personal':true};
 const restored=restoreInternalFiles(current,enabled.previous);
 assert.equal(restored[key],true);assert.equal(restored[second],false);assert.deepEqual(restored[third],{when:'new-setting'});assert.equal(restored['**/personal'],true);
 assert.equal(restored[patterns[3]],undefined);
});
