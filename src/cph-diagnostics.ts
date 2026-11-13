export type CphStep=<T>(label:string,run:()=>PromiseLike<T>)=>Promise<T>;
export async function traceCph(log:(text:string)=>void,run:(step:CphStep)=>Promise<string>):Promise<string>{
 let stage='开始';log('[CPH] 开始发送');
 const step:CphStep=async(label,work)=>{stage=label;log(`[CPH] ${label}`);return await work();};
 try{const result=await run(step);log(`[CPH] ${result}`);return result;}
 catch(error){log(`[CPH] 失败（${stage}）：${error instanceof Error?error.message:String(error)}`);throw error;}
}
