import {test} from 'node:test';
import assert from 'node:assert/strict';
import {samplesFromMarkdown} from '../src/sample-markdown';
test('旧题面可以恢复引用块样例，不能把图示当输入',()=>{
 const markdown='### 题目描述\n\n```txt\nillustration\n```\n\n### 输入输出样例\n\n#### 示例\n\n> 输入\n\n```txt\n2\n..\n..\n```\n\n> 输出\n\n```txt\n0\n```\n';
 assert.deepEqual(samplesFromMarkdown(markdown),[{input:'2\n..\n..\n',output:'0\n'}]);
});
