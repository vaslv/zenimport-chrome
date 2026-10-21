/** Single construction point for the legacy remote transport. */
import {Backend} from '../../extension/backend-client.js';
import {remoteService} from './remote.js';
export function remoteApplication(config:{url:string;token:string;installationId?:string;datasetId?:string},fetcher?:typeof fetch){
  return remoteService(new Backend(config,fetcher));
}
