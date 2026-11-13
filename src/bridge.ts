import http,{IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {OFFICIAL_ORIGINS,Problem,validateProblem} from './problem';
import {PlatformResult} from './report';
import {BrowserLease,connectionState} from './connection';

export type JobKind='debug'|'submit'|'prepare';
export interface JobRequest {kind:JobKind;problemId:string;code:string;input?:string;debugMode?:'input'|'official'}
export interface Job extends Omit<JobRequest,'code'> {code?:string;id:string;state:'queued'|'claimed'|'finished'|'expired';created:number;worker?:string;result?:PlatformResult}
interface Options {token:string;onImport:(p:Problem)=>Promise<unknown>;onUpdate?:(j:Job)=>void;jobTimeoutMs?:number;heartbeatTtlMs?:number}
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export class BridgeServer {
 private server:http.Server;private pairing?:{code:string,expires:number};private attempts:number[]=[];
 private jobs=new Map<string,Job>();private timer?:NodeJS.Timeout;private importChain:Promise<unknown>=Promise.resolve();
 public port=0;public lastBrowserSeen=0;
 private leases=new Map<string,BrowserLease>();
 get listening(){return this.server.listening;}
 connection(id:string){return connectionState(this.listening,id,[...this.leases.values()],[...this.jobs.values()].some(j=>j.state==='queued'||j.state==='claimed'),Date.now(),this.options.heartbeatTtlMs);}
 recheck(id:string){for(const [worker,l] of this.leases)if(l.problemId===id)this.leases.delete(worker);}
 constructor(private options:Options){
  this.server=http.createServer((req,res)=>{void this.handle(req,res).catch(e=>this.reply(res,e instanceof HttpError?e.status:400,{error:e instanceof Error?e.message:'请求失败'}));});
  this.server.requestTimeout=10_000;this.server.headersTimeout=10_000;this.server.maxHeadersCount=25;
 }
 async listen(port:number){
  if(port===27121)throw new Error('27121 属于现有 CPH，请选择独立端口');
  await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',()=>{this.server.off('error',reject);resolve();});});
  this.port=(this.server.address() as {port:number}).port;this.timer=setInterval(()=>this.expire(),1000);this.timer.unref();
 }
 async close(){if(this.timer)clearInterval(this.timer);for(const j of this.jobs.values()){j.code=undefined;j.input=undefined;}this.leases.clear();this.server.closeAllConnections();if(this.server.listening)await new Promise<void>(r=>this.server.close(()=>r()));}
 createPairing(){if(!this.listening)throw new Error('本地服务不可用，无法配对；请检查端口占用。');this.pairing={code:randomBytes(12).toString('base64url'),expires:Date.now()+300_000};return {...this.pairing};}
 revoke(token:string){this.options.token=token;this.pairing=undefined;for(const j of this.jobs.values())if(j.state==='queued'||j.state==='claimed'){j.code=undefined;j.input=undefined;j.state='expired';j.result={phase:'unknown',message:'授权已撤销；任务不会重发，请检查官方记录。'};this.options.onUpdate?.(j);}this.leases.clear();this.lastBrowserSeen=0;}
 enqueue(request:JobRequest):Job {
  this.expire();
  if(!/^\d{1,10}$/.test(request.problemId)||!['debug','submit','prepare'].includes(request.kind)||!request.code||request.code.length>500_000||(request.input?.length||0)>600_000)throw new Error('任务数据无效或过大');
  if([...this.jobs.values()].some(j=>j.state==='queued'||j.state==='claimed'))throw new Error('已有任务正在执行，请等待结果，避免重复提交');
  const connection=this.connection(request.problemId);if(!connection.canRunOnline)throw new Error(`${connection.label}：${connection.detail}`);
  const job:Job={...request,id:randomUUID(),created:Date.now(),state:'queued'};this.jobs.set(job.id,job);
  if(this.jobs.size>100)this.jobs.delete(this.jobs.keys().next().value!);this.options.onUpdate?.(job);return job;
 }
 recent(){this.expire();return [...this.jobs.values()].map(({code,input,...j})=>j);}
 expire(){for(const j of this.jobs.values())if(['queued','claimed'].includes(j.state)&&Date.now()-j.created>(this.options.jobTimeoutMs||180_000)){
  const claimed=j.state==='claimed';j.state='expired';j.code=undefined;j.input=undefined;j.result={phase:claimed?'unknown':'error',message:claimed?'等待官方结果超时；平台可能已收到请求。请先查看官方记录，勿重复提交。':'网页未接收任务，已取消本地排队；代码没有发送给网页。'};this.options.onUpdate?.(j);
 }}
 private reply(res:ServerResponse,status:number,data:unknown){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 private async body(req:IncomingMessage){
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req){size+=chunk.length;if(size>2_500_000)throw new HttpError(413,'请求体过大');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON 无效');}
 }
 private async handle(req:IncomingMessage,res:ServerResponse){
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${this.port}`)throw new HttpError(403,'仅允许回环地址与正确 Host');
  const origin=req.headers.origin;if(origin&&!OFFICIAL_ORIGINS.has(origin))throw new HttpError(403,'来源不受信任');
  // 不开放 CORS。GM 特权请求可以不带 Origin，仍须自定义头与高熵令牌。
  if(req.method!=='POST'||req.headers['x-lanqiao-client']!=='userscript-v1'||!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(403,'请求类型不受支持');
  if(req.url!=='/pair'&&!equal(req.headers.authorization||'',`Bearer ${this.options.token}`))throw new HttpError(401,'未授权，请重新配对浏览器');
  const body=await this.body(req);
  if(req.url==='/pair'){
   this.attempts=this.attempts.filter(t=>Date.now()-t<60_000);if(this.attempts.length>=10)throw new HttpError(429,'配对尝试过多，请一分钟后重试');this.attempts.push(Date.now());
   if(!this.pairing||this.pairing.expires<Date.now()||typeof body.code!=='string'||!equal(body.code,this.pairing.code))throw new HttpError(401,'配对码无效、已使用或过期');
   this.pairing=undefined;this.reply(res,200,{token:this.options.token});return;
  }
  this.lastBrowserSeen=Date.now();this.expire();
  if(req.url==='/status'){this.reply(res,200,{service:'lanqiao-oj-bridge',version:1});return;}
  if(req.url==='/import'){
   const p=validateProblem(body);const work=this.importChain.then(()=>this.options.onImport(p));this.importChain=work.catch(()=>undefined);
   this.reply(res,200,await work);return;
  }
  if(req.url==='/poll'){
   if(typeof body.problemId!=='string'||!/^\d{1,10}$/.test(body.problemId)||typeof body.worker!=='string'||!/^[\w-]{1,80}$/.test(body.worker))throw new HttpError(400,'浏览器标识无效');
   if(body.protocol!==undefined&&(body.protocol!==2||typeof body.editorReady!=='boolean'||typeof body.language!=='string'||body.language.length>40))throw new HttpError(400,'浏览器心跳格式无效');
   const previous=this.leases.get(body.worker);
   const lease:BrowserLease={worker:body.worker,problemId:body.problemId,seen:Date.now(),protocol:body.protocol||1,editorReady:body.editorReady===true,language:body.language||'',loginRequired:previous?.problemId===body.problemId&&previous?.loginRequired};
   for(const [key,l] of this.leases)if(Date.now()-l.seen>60_000)this.leases.delete(key);
   this.leases.set(body.worker,lease);if(this.leases.size>100)this.leases.delete(this.leases.keys().next().value!);
   const j=lease.protocol===2&&lease.editorReady&&lease.language==='cpp'&&!lease.loginRequired?[...this.jobs.values()].find(j=>j.state==='queued'&&j.problemId===body.problemId):undefined;
   if(j){j.state='claimed';j.worker=body.worker;this.options.onUpdate?.(j);}
   this.reply(res,200,{job:j?{id:j.id,kind:j.kind,problemId:j.problemId,code:j.code,input:j.input}:null});return;
  }
  if(req.url==='/result'){
   const j=this.jobs.get(body.id);if(!j||j.state!=='claimed'||j.worker!==body.worker)throw new HttpError(409,'任务失效或接收者不匹配');
   const r=body.result as PlatformResult;
   if(!r||!['prepared','sent','accepted','judging','done','error','unknown'].includes(r.phase)||JSON.stringify(r).length>1_500_000)throw new HttpError(400,'结果格式无效');
   // 显式选取结果字段，不把浏览器任意属性持久化。
   j.result={phase:r.phase};
   for(const key of ['status','submissionId','message','stdout','stderr'] as const)if(typeof r[key]==='string')j.result[key]=r[key];
   if(r.errorCode==='login_required'){j.result.errorCode=r.errorCode;const lease=this.leases.get(body.worker);if(lease)lease.loginRequired=true;}
   for(const key of ['time','runtime','memory','passRate'] as const)if(r[key]!==undefined)j.result[key]=r[key];
   if(Array.isArray(r.testCases))j.result.testCases=r.testCases;
   if(['done','error','unknown','prepared'].includes(r.phase)){j.state='finished';j.code=undefined;j.input=undefined;}
   this.options.onUpdate?.(j);this.reply(res,200,{ok:true});return;
  }
  throw new HttpError(404,'没有此接口');
 }
}
