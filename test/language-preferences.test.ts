import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LanguagePreferences} from '../src/language-preferences';
test('语言选择持久保存，旧题记住各自语言，新题沿用最后选择',async()=>{
 const values=new Map<string,unknown>();let language:'c'|'cpp'='cpp';
 const state={get:(key:string)=>values.get(key),update:async(key:string,value:unknown)=>{values.set(key,value);}};
 const preferences=()=>new LanguagePreferences(state,()=>language,async value=>{language=value;});
 await preferences().choose('124','c');
 assert.equal(preferences().forProblem('124'),'c');assert.equal(preferences().forProblem('2377'),'c');
 await preferences().choose('2377','cpp');
 assert.equal(preferences().forProblem('124'),'c');assert.equal(preferences().forProblem('2377'),'cpp');assert.equal(preferences().forProblem('3008'),'cpp');
});
test('明确打开旧题 C++ 源码只记住该题，不重置默认 C 语言',async()=>{
 const values=new Map<string,unknown>();let updates=0;
 const state={get:(key:string)=>values.get(key),update:async(key:string,value:unknown)=>{values.set(key,value);}};
 const p=new LanguagePreferences(state,()=> 'c',async()=>{updates++;});
 await p.rememberProblem('124','cpp');
 assert.equal(p.forProblem('124'),'cpp');assert.equal(p.forProblem('3008'),'c');assert.equal(updates,0);
});
test('异常历史中的未支持语言被忽略',()=>{
 const p=new LanguagePreferences({get:()=>({'124':'python'}),update:async()=>{}},()=> 'cpp',async()=>{});
 assert.equal(p.forProblem('124'),'cpp');
});
test('保存较小题号的偏好时不会因已有较大题号而被丢弃',async()=>{
 let saved:unknown=Object.fromEntries(Array.from({length:500},(_,i)=>[String(1000+i),'cpp']));
 const p=new LanguagePreferences({get:()=>saved,update:async(_key,value)=>{saved=value;}},()=> 'cpp',async()=>{});
 await p.rememberProblem('124','c');assert.equal(p.forProblem('124'),'c');
});
