/** A commit receipt for the disposable source cache, never a persisted authority. */
import type {FinancialDatabase} from './database.js';
import type {RuntimeControl} from '../../control/types.js';
import type {RepositorySession} from './kernel.js';
import {runtimeControl} from '../../control/validation.js';
import {financialStamp} from './source-stamp.js';
import {hasSource,publishSource} from './source-cache.js';
export async function sourcePublication(db:FinancialDatabase,root:RuntimeControl,view:RepositorySession){
 const key=JSON.stringify([db.name,root.installationId]);if(!hasSource(key))return null;
 const before=await financialStamp(db,root,view);view.sourceChanges.enabled=true;
 return async()=>{const after=await financialStamp(db,runtimeControl(await db.runtime.get('runtime')),view);return ()=>publishSource(key,before,after,view.sourceChanges);};
}
