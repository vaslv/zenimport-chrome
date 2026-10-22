import {installBackground} from './background-runtime.js';
import {ApplicationRuntime} from '../src/application/runtime.ts';
import {trustedSentinel} from '../src/control/sentinel.ts';
import {ZENMONEY_ORIGIN} from '../src/local/zenmoney/reader.ts';
import {permissionOrigin} from './backend-client.js';
const area=chrome.storage.local;
installBackground({standalone:true,runtime:new ApplicationRuntime(area,trustedSentinel(area),'zenimport-financial',undefined,{
  session:chrome.storage.session,
  permission:()=>chrome.permissions.contains({origins:[ZENMONEY_ORIGIN]}),
  serverPermission:url=>chrome.permissions.contains({origins:[permissionOrigin(url)]}),
})});
