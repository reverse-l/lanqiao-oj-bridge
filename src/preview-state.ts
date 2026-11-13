import {parsePreviewAction,PreviewAction} from './preview';
export interface PreviewState {version:1;source:string;scrollY:number}
const scroll=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100_000_000;
export function parsePreviewState(value:unknown,knownSources:readonly string[]):PreviewState|undefined {
 const v=value as PreviewState;
 if(v?.version===1&&typeof v.source==='string'&&knownSources.includes(v.source)&&scroll(v.scrollY))return {version:1,source:v.source,scrollY:v.scrollY};
}
export function parsePreviewMessage(value:unknown):{action:PreviewAction}|{action:'copyBlock';index:number}|{type:'viewState';scrollY:number}|{type:'ready'}|undefined {
 const action=parsePreviewAction(value);if(action)return {action};
 const v=value as Record<string,unknown>;
 if(v&&Object.keys(v).length===2&&v.action==='copyBlock'&&Number.isInteger(v.index)&&(v.index as number)>=0&&(v.index as number)<10000)return {action:'copyBlock',index:v.index as number};
 if(v&&Object.keys(v).length===1&&v.type==='ready')return {type:'ready'};
 if(v&&Object.keys(v).length===2&&v.type==='viewState'&&scroll(v.scrollY))return {type:'viewState',scrollY:v.scrollY};
}
