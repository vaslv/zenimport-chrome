/** Readiness of the captured source only; this never initiates a network call. */
import type {RowByTable} from '../storage/schema.generated.js';
import type {FinancialSnapshot} from '../storage/source-stamp.js';
import type {SourceSnapshot} from './source.js';
import {int64,requireStorage} from '../storage/types.js';
export function mirrorFresh(state:RowByTable['zen_mirror_state']|undefined,stamp:Pick<FinancialSnapshot,'mirrorControl'|'credentialRef'>,now:string){
  const control=JSON.parse(stamp.mirrorControl) as {lease?:unknown;forceFull?:boolean}|null,at=BigInt(int64(now));
  if(control!==null)requireStorage(typeof control==='object'&&!Array.isArray(control)&&Object.keys(control).sort().join(',')==='error,failures,forceFull,lease,nextAt,projectionGeneration'&&typeof control.forceFull==='boolean'&&Object.hasOwn(control,'lease'),'storage_corrupt');
  return control!==null&&stamp.credentialRef!==null&&state?.ready==='1'&&state.needs_full==='0'&&state.refreshed_at!==null&&
    at>=BigInt(state.refreshed_at)&&at-BigInt(state.refreshed_at)<=300n&&control?.lease==null&&control?.forceFull!==true;
}

export function sourceFresh(source:SourceSnapshot,now:string){return mirrorFresh(source.rows.zen_mirror_state[0],source.stamp,now);}
