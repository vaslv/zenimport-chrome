/** Single construction point for the legacy remote transport. */
import {Backend} from '../../extension/backend-client.js';
import {remoteService} from './remote.js';
export function remoteApplication(config:{url:string;token:string},fetcher?:typeof fetch){
  return remoteService(new Backend(config,fetcher));
}
