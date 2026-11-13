import {installPreviewClient} from './client';
declare function acquireVsCodeApi():{postMessage:(value:unknown)=>void;setState:(value:unknown)=>void};
installPreviewClient(window,acquireVsCodeApi(),JSON.parse(document.body.dataset.preview!));
