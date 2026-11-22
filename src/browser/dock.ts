import {BRIDGE_ICON} from '../bridge-icon';

interface Position {side:'left'|'right';y:number;expanded:boolean}
interface Options {read:()=>unknown;write:(position:Position)=>void;importProblem:()=>void|Promise<void>;pair:()=>void|Promise<void>;status:string}
export interface BridgeDock {element:HTMLElement;setStatus:(text:string)=>void;reset:()=>void;dispose:()=>void}
const defaults=():Position=>({side:'right',y:.5,expanded:false});
function position(value:unknown):Position {
 const p=value as Partial<Position>|null;
 return {side:p?.side==='left'?'left':'right',y:typeof p?.y==='number'&&Number.isFinite(p.y)?Math.max(0,Math.min(1,p.y)):.5,expanded:p?.expanded===true};
}

export function mountDock(page:Window,options:Options):BridgeDock {
 const doc=page.document,element=doc.createElement('div');element.id='lanqiao-bridge';
 const root=element.attachShadow({mode:'open'});
 root.innerHTML=`<style>
 :host{all:initial;position:fixed;z-index:9999;width:44px;height:54px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;--paper:light-dark(#fff,#252b35);--ink:light-dark(#233041,#e1e8f3);--muted:light-dark(#5b687a,#afbdcf);--border:light-dark(#dce4ed,#465164);--blue:light-dark(#0869c3,#8ec7ff);color:var(--ink)}
 *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--blue);outline-offset:3px}svg{display:block;pointer-events:none}
 .handle{display:grid;place-items:center;width:44px;height:54px;padding:5px;border:1px solid var(--border);border-right:0;border-radius:16px 0 0 16px;background:var(--paper);color:var(--blue);box-shadow:0 3px 16px #10243d20;touch-action:none;cursor:grab;user-select:none}
 :host([data-side=left]) .handle{border-left:0;border-right:1px solid var(--border);border-radius:0 16px 16px 0}.handle:active{cursor:grabbing}
 .panel{position:absolute;top:0;right:54px;width:min(264px,calc(100vw - 66px));max-height:calc(100vh - 16px);overflow:auto;padding:15px;border:1px solid var(--border);border-radius:14px;background:var(--paper);box-shadow:0 8px 30px #10243d24}
 :host([data-side=left]) .panel{right:auto;left:54px}.panel[hidden]{display:none}:host([data-dragging]) .panel{visibility:hidden}
 .heading{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-weight:600}.heading svg{width:22px;height:22px;color:var(--blue)}
 .close{margin-left:auto;border:0;border-radius:4px;background:transparent;color:var(--muted);width:28px;height:28px;font-size:20px}
 .import{width:100%;padding:9px;border:0;border-radius:7px;background:#0869c3;color:white;font-weight:500}.import:disabled{opacity:.6;cursor:wait}
 .footer{display:flex;gap:12px;align-items:center;margin-top:12px}.pair{border:0;background:transparent;color:var(--blue);padding:4px 0;margin-left:auto}
 .status{color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;max-height:110px;overflow:auto;flex:1;font-size:12px}
 @media(pointer:coarse){.close,.pair{min-width:44px;min-height:44px}.import{min-height:44px}}
 </style><div class="panel" id="bridge-panel" hidden><div class="heading">${BRIDGE_ICON}<span>Lanqiao Bridge</span><button type="button" class="close" aria-label="收起控件">×</button></div><button type="button" class="import" data-action="import">导入 VSCode</button><div class="footer"><span class="status" role="status" aria-live="polite"></span><button type="button" class="pair" data-action="pair">配对</button></div></div><button type="button" class="handle" aria-label="展开 Lanqiao Bridge；拖动可贴边" aria-controls="bridge-panel" aria-expanded="false" title="点击展开 / 收起 · 拖动贴边">${BRIDGE_ICON}</button>`;
 let state=position(options.read()),drag:{x:number;y:number;top:number;left:number}|undefined,moved=false;
 const handle=root.querySelector<HTMLButtonElement>('.handle')!,panel=root.querySelector<HTMLElement>('.panel')!;
 const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(Math.max(min,max),n));
 const render=()=>{
  element.dataset.side=state.side;element.style.left=state.side==='left'?'0px':'auto';element.style.right=state.side==='right'?'0px':'auto';
  panel.hidden=!state.expanded;handle.setAttribute('aria-expanded',String(state.expanded));handle.setAttribute('aria-label',`${state.expanded?'收起':'展开'} Lanqiao Bridge；拖动可贴边`);
  const height=state.expanded?Math.max(54,panel.offsetHeight||190):54;
  element.style.top=clamp(state.y*Math.max(0,page.innerHeight-54),8,page.innerHeight-height-8)+'px';
 };
 const save=()=>options.write({...state});
 const toggle=(expanded:boolean)=>{state.expanded=expanded;render();save();};
 handle.addEventListener('click',()=>{if(moved){moved=false;return;}toggle(!state.expanded);});
 root.querySelector<HTMLButtonElement>('.close')!.addEventListener('click',()=>{toggle(false);handle.focus();});
 const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&state.expanded){toggle(false);handle.focus();}};
 root.addEventListener('keydown',keydown as EventListener);
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const rect=element.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:state.side==='left'?0:page.innerWidth-44,top:parseFloat(element.style.top)||rect.top};moved=false;
  handle.setPointerCapture?.(event.pointerId);
 });
 handle.addEventListener('pointermove',event=>{
  if(!drag)return;
  if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6)moved=true;
  if(!moved)return;
  element.dataset.dragging='';element.style.right='auto';element.style.left=clamp(drag.left+event.clientX-drag.x,0,page.innerWidth-44)+'px';element.style.top=clamp(drag.top+event.clientY-drag.y,8,page.innerHeight-62)+'px';
 });
 const endDrag=(event:PointerEvent)=>{
  if(!drag)return;
  if(moved){state.side=event.clientX<page.innerWidth/2?'left':'right';state.y=clamp(parseFloat(element.style.top)/Math.max(1,page.innerHeight-54),0,1);}
  drag=undefined;delete element.dataset.dragging;render();save();
 };
 handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',event=>{endDrag(event);moved=false;});
 for(const [action,callback] of [['import',options.importProblem],['pair',options.pair]] as const){
  const button=root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  button.addEventListener('click',()=>{if(button.disabled)return;button.disabled=true;try{Promise.resolve(callback()).catch(error=>setStatus(String(error))).finally(()=>{button.disabled=false;render();});}catch(error){setStatus(String(error));button.disabled=false;}});
 }
 function setStatus(text:string){root.querySelector<HTMLElement>('.status')!.textContent=text;render();}
 const resize=()=>{drag=undefined;delete element.dataset.dragging;render();};page.addEventListener('resize',resize);
 doc.body.appendChild(element);setStatus(options.status);
 return {element,setStatus,reset:()=>{state=defaults();render();save();},dispose:()=>{page.removeEventListener('resize',resize);element.remove();}};
}
