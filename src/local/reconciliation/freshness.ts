/** Readiness of the captured source only; this never initiates a network call. */
import type {SourceSnapshot} from './source.js';
import {int64,requireStorage} from '../storage/types.js';
export function sourceFresh(source:SourceSnapshot,now:string){
  const state=source.rows.zen_mirror_state[0],control=JSON.parse(source.stamp.mirrorControl) as {lease?:unknown;forceFull?:boolean}|null,at=BigInt(int64(now));
  if(control!==null)requireStorage(typeof control==='object'&&!Array.isArray(control)&&Object.keys(control).sort().join(',')==='error,failures,forceFull,lease,nextAt,projectionGeneration'&&typeof control.forceFull==='boolean'&&Object.hasOwn(control,'lease'),'storage_corrupt');
  return control!==null&&source.stamp.credentialRef!==null&&state?.ready==='1'&&state.needs_full==='0'&&state.refreshed_at!==null&&
    at>=BigInt(state.refreshed_at)&&at-BigInt(state.refreshed_at)<=300n&&control?.lease==null&&control?.forceFull!==true;
}
