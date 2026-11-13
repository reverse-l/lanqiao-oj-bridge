import MarkdownIt from 'markdown-it';
import {SampleCollector} from './sample-collector';
export function samplesFromMarkdown(markdown:string){
 const tokens=new MarkdownIt({html:false}).parse(markdown,{}),collector=new SampleCollector();
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(token.type==='heading_open'){collector.heading(tokens[i+1]?.content||'',Number(token.tag.slice(1)));i+=2;}
  else if(token.type==='inline')collector.label(token.content);
  else if(token.type==='fence'||token.type==='code_block')collector.code(token.content);
 }
 return collector.finish();
}
