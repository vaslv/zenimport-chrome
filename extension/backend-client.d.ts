/** Types for the existing API1 HTTP transport; not an application service. */
export class SyncError extends Error{code:string;retryable:boolean;constructor(code:string,retryable?:boolean)}
export function serverAddress(value:string):string;
export function permissionOrigin(value:string):string;
export class Backend{
  constructor(config:{url:string;token:string},fetcher?:typeof fetch);
  info():Promise<unknown>;
  request(path:string,method?:string,body?:unknown):Promise<unknown>;
  transfer(action:'export'|'import',file?:Blob):Promise<unknown>;
}
