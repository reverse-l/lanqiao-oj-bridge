import type {Sample} from './problem';
export class SampleCollector {
 private scope=false;private level=0;private role:'input'|'output'|undefined;private inputs:string[]=[];private outputs:string[]=[];
 heading(text:string,level:number){
  const sample=/(样例|示例|sample|example)/i.test(text),input=/输入|input/i.test(text),output=/输出|output/i.test(text);
  if(sample){if(!this.scope||level<=this.level)this.level=level;this.scope=true;this.role=input&&!output?'input':output&&!input?'output':undefined;}
  else{this.role=undefined;if(level<=this.level)this.scope=false;}
 }
 label(text:string){if(!this.scope)return;const t=text.replace(/\s+/g,'').replace(/[：:]$/,'');if(/^(输入|input)\d*$/i.test(t))this.role='input';else if(/^(输出|output)\d*$/i.test(t))this.role='output';}
 code(text:string){if(this.scope&&this.role)(this.role==='input'?this.inputs:this.outputs).push(text);}
 finish():Sample[]{if(this.inputs.length!==this.outputs.length)throw new Error('输入输出样例数量不匹配，停止导入以避免错误关联');return this.inputs.map((input,i)=>({input,output:this.outputs[i]}));}
}
