/** Reserve every local routing/credential fence before a live transfer hold. */
import type {RuntimeControl} from '../../control/types.js';
import {int64} from './types.js';
export function transferBudget(root:RuntimeControl){
  // One routing increment takes the hold; another cancels or selects the target.
  int64(String(BigInt(root.epoch)+2n));int64(String(BigInt(root.credentialEpoch)+1n));
}
