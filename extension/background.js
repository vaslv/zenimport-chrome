import {installBackground} from './background-runtime.js';
import {ApplicationRuntime} from '../src/application/runtime.ts';
import {trustedSentinel} from '../src/control/sentinel.ts';
installBackground({runtime:new ApplicationRuntime(chrome.storage.local,trustedSentinel(chrome.storage.local))});
