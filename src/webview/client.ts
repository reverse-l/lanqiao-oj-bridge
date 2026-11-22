import {escapeHtml} from '../result-card';
import type {PreviewState} from '../preview-state';
import type {ConnectionState} from '../connection';
interface Host {postMessage:(value:unknown)=>void;setState:(value:PreviewState)=>void}
export function installPreviewClient(win:Window,host:Host,initial:PreviewState){
 const doc=win.document;let pending=false,online=false,touched=false,scrollTimer:ReturnType<typeof setTimeout>|undefined,statusTimer:ReturnType<typeof setTimeout>|undefined;
 const showStatus=(text:string,temporary=false)=>{clearTimeout(statusTimer);doc.querySelector('#status')!.textContent=text;if(temporary)statusTimer=setTimeout(()=>{doc.querySelector('#status')!.textContent='';},3500);};
 const buttons=()=>doc.querySelectorAll<HTMLButtonElement>('button[data-action],button[data-copy-block]');
 const refresh=()=>buttons().forEach(b=>b.disabled=pending||(['debug','submit'].includes(b.dataset.action||'')&&!online));
 doc.addEventListener('click',event=>{const b=(event.target as Element)?.closest<HTMLButtonElement>('button[data-action],button[data-copy-block]');if(!b||b.disabled)return;pending=true;refresh();showStatus('正在处理…');host.postMessage(b.dataset.copyBlock!==undefined?{action:'copyBlock',index:Number(b.dataset.copyBlock)}:{action:b.dataset.action});});
 win.addEventListener('message',event=>{
  const data=event.data;if(!data||typeof data!=='object')return;
  if(data.type==='actionResult'){showStatus(typeof data.text==='string'?data.text:'',data.level==='success');pending=false;}
  if(data.type==='snapshot'){pending=data.pending===true;showStatus(typeof data.text==='string'?data.text:'');}
  if(data.type==='connection'||data.type==='snapshot'){
   const c=data.connection as ConnectionState;online=c?.canRunOnline===true;
   doc.querySelector('#connection')!.innerHTML=`<strong title="${escapeHtml(c.detail)}">${escapeHtml(c.label)}</strong><button data-action="check">重新检测</button><button data-action="pair">配对</button>`;
  }
  refresh();
 });
 const save=()=>{const state:PreviewState={version:1,source:initial.source,scrollY:Math.max(0,win.scrollY)};host.setState(state);return state;};
 win.addEventListener('scroll',()=>{save();clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>host.postMessage({type:'viewState',scrollY:save().scrollY}),100);},{passive:true});
 win.addEventListener('blur',()=>host.postMessage({type:'viewState',scrollY:save().scrollY}));
 for(const event of ['wheel','touchstart','keydown','pointerdown'])win.addEventListener(event,()=>{touched=true;},{once:true,passive:true});
 host.setState(initial);
 const restore=()=>win.requestAnimationFrame(()=>{if(!touched)win.scrollTo(0,initial.scrollY);});
 // 字体与图片加载前先定位一次；加载完成后只在用户尚未滚动时微调。
 restore();void doc.fonts?.ready.then(restore);win.addEventListener('load',restore,{once:true});
 online=!(doc.querySelector<HTMLButtonElement>('[data-action="debug"]')?.disabled??true);refresh();
 host.postMessage({type:'ready'});
}
