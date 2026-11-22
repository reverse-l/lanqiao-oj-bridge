import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountDock} from '../src/browser/dock';

function setup(saved:unknown=null){
 const {window,document}=parseHTML('<html><body></body></html>');
 Object.assign(window,{innerWidth:900,innerHeight:600});
 const writes:unknown[]=[];let imports=0,pairs=0;
 const dock=mountDock(window as any,{read:()=>saved,write:s=>writes.push(s),importProblem:()=>{imports++;},pair:()=>{pairs++;},status:'等待连接'});
 const root=dock.element.shadowRoot!;
 const handle=root.querySelector<HTMLButtonElement>('.handle')!;
 const pointer=(type:string,x:number,y:number)=>{const e=new window.Event(type);Object.assign(e,{button:0,pointerId:1,clientX:x,clientY:y});handle.dispatchEvent(e);};
 return {window,document,dock,root,handle,pointer,writes,counts:()=>({imports,pairs})};
}
test('默认贴右收起，点击展开后可导入与配对，状态按纯文本更新',()=>{
 const w=setup();assert.equal(w.handle.getAttribute('aria-expanded'),'false');assert.equal(w.dock.element.style.right,'0px');
 w.handle.click();assert.equal(w.handle.getAttribute('aria-expanded'),'true');
 w.root.querySelector<HTMLButtonElement>('[data-action="import"]')!.click();w.root.querySelector<HTMLButtonElement>('[data-action="pair"]')!.click();
 assert.deepEqual(w.counts(),{imports:1,pairs:1});
 w.dock.setStatus('<script>bad()</script>');assert.equal(w.root.querySelector('[role="status"]')?.textContent,'<script>bad()</script>');assert.equal(w.root.querySelector('script'),null);
 w.root.querySelector<HTMLButtonElement>('.close')!.click();assert.equal(w.handle.getAttribute('aria-expanded'),'false');
 w.dock.dispose();assert.equal(w.document.querySelector('#lanqiao-bridge'),null);
});
test('拖动到另一侧会记住位置，不会被随后的 click 当成展开',()=>{
 const w=setup();w.pointer('pointerdown',880,290);w.pointer('pointermove',20,160);w.pointer('pointerup',20,160);w.handle.click();
 assert.equal(w.handle.getAttribute('aria-expanded'),'false');assert.equal(w.dock.element.style.left,'0px');
 const saved=w.writes.at(-1) as any;assert.equal(saved.side,'left');assert.ok(saved.y>=0&&saved.y<=1);
 const restored=setup(saved);assert.equal(restored.dock.element.style.left,'0px');assert.equal(restored.handle.getAttribute('aria-expanded'),'false');
});
test('损坏位置、小屏与缩放不会让控件消失；重置恢复默认贴边位置',()=>{
 const w=setup({side:'oops',y:Infinity,expanded:'bad'});assert.equal(w.dock.element.style.right,'0px');
 Object.assign(w.window,{innerWidth:320,innerHeight:200});w.window.dispatchEvent(new w.window.Event('resize'));
 assert.ok(parseFloat(w.dock.element.style.top)>=0&&parseFloat(w.dock.element.style.top)<=146);
 w.handle.click();w.window.dispatchEvent(new w.window.Event('resize'));
 assert.ok(parseFloat(w.dock.element.style.top)>=0);
 w.dock.reset();assert.equal(w.handle.getAttribute('aria-expanded'),'false');assert.equal(w.dock.element.style.right,'0px');
});
