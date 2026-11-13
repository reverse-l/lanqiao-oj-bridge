export interface ConnectionState {
 kind:'ready'|'waiting'|'needs-update'|'editor-unavailable'|'login-required'|'busy'|'service-unavailable';
 label:string;detail:string;canRunOnline:boolean;
}
export interface BrowserLease {problemId:string;worker:string;seen:number;protocol:number;editorReady:boolean;language:string;loginRequired?:boolean}
export function connectionState(listening:boolean,id:string,leases:BrowserLease[],busy:boolean,now=Date.now(),ttl=20_000):ConnectionState {
 const result=(kind:ConnectionState['kind'],label:string,detail:string):ConnectionState=>({kind,label,detail,canRunOnline:kind==='ready'});
 if(!listening)return result('service-unavailable','本地服务不可用','端口可能被另一个 VSCode 窗口占用，请在该窗口操作，或修改 Lanqiao 端口后重载。CPH 本地测试仍可用。');
 if(busy)return result('busy','在线任务处理中','请等待当前任务完成；不会重复发送代码或提交。');
 const same=leases.filter(l=>l.problemId===id&&now-l.seen<ttl);
 if(!same.length)return result('waiting',`等待 #${id} 网页连接`,'打开本题蓝桥网页并保持已配对脚本运行；其他题目页面的连接不计入本题。');
 if(same.some(l=>l.protocol===2&&l.editorReady&&l.language==='cpp'&&!l.loginRequired))return result('ready',`#${id} 网页已连接`,'官方 C++ 编辑器已就绪；登录状态未知，以平台实际响应为准。');
 if(same.some(l=>l.loginRequired))return result('login-required','登录失效或权限不足','官方返回鉴权失败。请在网页完成登录，再点击「重新检测」；不会自动重试。');
 if(same.every(l=>l.protocol!==2))return result('needs-update','请更新浏览器脚本','已连接旧脚本；导入仍可用，在线操作需要安装扩展随附的 v0.3 脚本并刷新网页。');
 return result('editor-unavailable','官方编辑器未就绪','请等待网页加载、检查登录及 C++ 语言选择；若持续出现，请检查页面结构变化。');
}
