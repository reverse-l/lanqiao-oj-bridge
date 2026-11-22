import http,{IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {OFFICIAL_ORIGINS,Problem,validateProblem,normalizeCourseUrl,type ProblemSource} from './problem';
import {PlatformResult} from './report';
import {BrowserLease,connectionState,matchesSource,supportsLanguage,type SourceScope} from './connection';
import {LanguageId,requireLanguage} from './languages';

export type JobKind='debug'|'submit'|'prepare';
export interface JobRequest {kind:JobKind;problemId:string;code:string;input?:string;debugMode?:'input'|'official';language?:LanguageId;sourceName?:string;sourceScope?:SourceScope}
export interface Job extends Omit<JobRequest,'code'> {code?:string;id:string;state:'queued'|'claimed'|'finished'|'expired';created:number;worker?:string;result?:PlatformResult;problemSource?:ProblemSource}
interface Options {token:string;onImport:(p:Problem)=>Promise<unknown>;onUpdate?:(j:Job)=>void|Promise<void>;jobTimeoutMs?:number;heartbeatTtlMs?:number}
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export class BridgeServer {
 private server:http.Server;private pairing?:{code:string,expires:number};private attempts:number[]=[];
 private jobs=new Map<string,Job>();private timer?:NodeJS.Timeout;private importChain:Promise<unknown>=Promise.resolve();
 private stagingSubmission = false;
 public port=0;public lastBrowserSeen=0;
 private leases=new Map<string,BrowserLease>();
 get listening(){return this.server.listening;}
 connection(id:string,language:LanguageId='cpp',scope?:SourceScope){
  const leases = [...this.leases.values()].filter(lease => matchesSource(lease, scope));
  const busy = this.stagingSubmission || this.hasActiveJob();
  const state = connectionState(this.listening,id,leases,busy,Date.now(),this.options.heartbeatTtlMs,language);
  if (scope && state.kind === 'waiting') {
   const source = scope.source === 'lanqiao-course' ? '课程单元' : '题库';
   return {...state, detail:`请打开本题的${source}网页。区分题目来源需要浏览器脚本 0.6.0 或更新版本。`};
  }
  return state;
 }
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
  return this.publish(this.createJob(request));
 }
 async enqueueSubmission(request: JobRequest, save: (job: Readonly<Job>) => Promise<void>): Promise<Job> {
  if (request.kind !== 'submit') throw new Error('只有正式提交需要快照');
  const job = this.createJob(request);
  if (!job.sourceScope) job.sourceScope = this.knownSource(job.problemId, job.language!);
  const authorization = this.options.token;
  this.stagingSubmission = true;
  try { await save(job); }
  finally { this.stagingSubmission = false; }

  const connection = this.connection(job.problemId, job.language, job.sourceScope);
  if (authorization !== this.options.token || !connection.canRunOnline) {
   job.state = 'expired';
   job.code = undefined;
   job.result = {phase: 'error', message: '保存快照期间网页连接或授权发生变化，代码未发送。'};
   await this.options.onUpdate?.(job);
   throw new Error(job.result.message);
  }
  return this.publish(job);
 }
 private knownSource(id: string, language: LanguageId): SourceScope | undefined {
  const now = Date.now(), ttl = this.options.heartbeatTtlMs ?? 20_000;
  for (const lease of this.leases.values()) {
   if (lease.problemId !== id || now - lease.seen >= ttl || !lease.editorReady || lease.loginRequired || !supportsLanguage(lease, language)) continue;
   if (lease.problemSource === 'lanqiao-oj') return {source: 'lanqiao-oj'};
   if (lease.problemSource === 'lanqiao-course' && lease.courseUrl) return {source: 'lanqiao-course', courseUrl: lease.courseUrl};
  }
 }
 private hasActiveJob(): boolean {
  return [...this.jobs.values()].some(job => job.state === 'queued' || job.state === 'claimed');
 }
 private createJob(request: JobRequest): Job {
  this.expire();
  const language=requireLanguage(request.language);
  if(request.sourceName!==undefined&&(typeof request.sourceName!=='string'||request.sourceName.length>200||/[\\/\x00-\x1f]/.test(request.sourceName)))throw new Error('源码文件名无效');
  if(!/^\d{1,10}$/.test(request.problemId)||!['debug','submit','prepare'].includes(request.kind)||!request.code||request.code.length>500_000||(request.input?.length||0)>600_000)throw new Error('任务数据无效或过大');
  if(this.stagingSubmission || this.hasActiveJob())throw new Error('已有任务正在执行，请等待结果，避免重复提交');
  const connection=this.connection(request.problemId,language,request.sourceScope);if(!connection.canRunOnline)throw new Error(`${connection.label}：${connection.detail}`);
  return {...request,language,id:randomUUID(),created:Date.now(),state:'queued'};
 }
 private publish(job: Job): Job {
  this.jobs.set(job.id,job);
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
   if(body.protocol!==undefined&&(![2,3].includes(body.protocol)||typeof body.editorReady!=='boolean'||typeof body.language!=='string'||body.language.length>40))throw new HttpError(400,'浏览器心跳格式无效');
   const problemSource: unknown = body.problemSource;
   if (problemSource !== undefined && problemSource !== 'lanqiao-oj' && problemSource !== 'lanqiao-course') throw new HttpError(400,'题目来源无效');
   const courseUrl = problemSource === 'lanqiao-course' && body.courseUrl !== undefined ? normalizeCourseUrl(body.courseUrl) : undefined;
   const previous=this.leases.get(body.worker);
   const samePage = previous?.problemId === body.problemId && previous?.problemSource === problemSource && previous?.courseUrl === courseUrl;
   const lease:BrowserLease={worker:body.worker,problemId:body.problemId,problemSource,courseUrl,seen:Date.now(),protocol:body.protocol||1,editorReady:body.editorReady===true,language:body.language||'',loginRequired:samePage&&previous?.loginRequired};
   for(const [key,l] of this.leases)if(Date.now()-l.seen>60_000)this.leases.delete(key);
   this.leases.set(body.worker,lease);if(this.leases.size>100)this.leases.delete(this.leases.keys().next().value!);
   const j=lease.editorReady&&!lease.loginRequired?[...this.jobs.values()].find(j=>j.state==='queued'&&j.problemId===body.problemId&&supportsLanguage(lease,j.language||'cpp')&&matchesSource(lease,j.sourceScope)):undefined;
   if(j){j.state='claimed';j.worker=body.worker;j.problemSource=problemSource;this.options.onUpdate?.(j);}
   this.reply(res,200,{job:j?{id:j.id,kind:j.kind,problemId:j.problemId,language:j.language,code:j.code,input:j.input}:null});return;
  }
  if(req.url==='/result'){
   const j=this.jobs.get(body.id);if(!j||j.state!=='claimed'||j.worker!==body.worker)throw new HttpError(409,'任务失效或接收者不匹配');
   const r=body.result as PlatformResult;
   if(!r||!['prepared','sent','accepted','judging','done','error','unknown'].includes(r.phase)||JSON.stringify(r).length>1_500_000)throw new HttpError(400,'结果格式无效');
   const previousReceipt = j.result?.submissionId;
   if (previousReceipt && typeof r.submissionId === 'string' && r.submissionId && r.submissionId !== previousReceipt) {
    throw new HttpError(409, '官方提交记录 ID 不一致，已忽略该结果');
   }
   // 显式选取结果字段，不把浏览器任意属性持久化。
   j.result={phase:r.phase};
   for(const key of ['status','submissionId','message','stdout','stderr'] as const)if(typeof r[key]==='string')j.result[key]=r[key];
   if (previousReceipt) j.result.submissionId = previousReceipt;
   if(r.errorCode==='login_required'){j.result.errorCode=r.errorCode;const lease=this.leases.get(body.worker);if(lease)lease.loginRequired=true;}
   for(const key of ['time','runtime','memory','passRate'] as const)if(r[key]!==undefined)j.result[key]=r[key];
   if(Array.isArray(r.testCases))j.result.testCases=r.testCases;
   if(['done','error','unknown','prepared'].includes(r.phase)){j.state='finished';j.code=undefined;j.input=undefined;}
   await this.options.onUpdate?.(j);this.reply(res,200,{ok:true});return;
  }
  throw new HttpError(404,'没有此接口');
 }
}
