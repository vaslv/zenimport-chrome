/** Exact, bounded combination proofs. Exhaustion is never a proved match. */
import {ExactMoney} from '../money.js';
export interface SearchBudget{remaining:number}
export interface SubsetProof{ids:string[]|null;reason:'unique'|'ambiguous'|'budget_exhausted'|'no_match'|'unsupported_size'}
const zero=()=>ExactMoney.parse('0');
const absolute=(value:ExactMoney)=>value.sign()<0?value.negate():value;
export function uniqueSubset(items:readonly (readonly [string,ExactMoney])[],target:ExactMoney,budget:SearchBudget):SubsetProof{
  if(!target.sign()||items.length<2||items.length>16)return {ids:null,reason:'unsupported_size'};
  const found:string[][]=[];let exhausted=false;
  const sameSign=items.every(([,value])=>value.sign()!==0&&value.sign()===target.sign());
  function visit(index:number,total:ExactMoney,ids:string[]){
    if(budget.remaining<=0){exhausted=true;return;}budget.remaining--;
    if(found.length>1||exhausted)return;
    if(index===items.length){if(total.equals(target)&&ids.length>1)found.push(ids);return;}
    if(sameSign&&absolute(total).compare(absolute(target))>0)return;
    const [key,value]=items[index];visit(index+1,total.add(value),[...ids,key]);visit(index+1,total,ids);
  }
  visit(0,zero(),[]);
  return exhausted?{ids:null,reason:'budget_exhausted'}:found.length===1?{ids:found[0],reason:'unique'}:
    {ids:null,reason:found.length>1?'ambiguous':'no_match'};
}

/** Report matching intentionally uses only same-sign, strictly smaller splits.
 * Preferred historical identities are tie-breakers after current amount checks.
 */
export function unmatchedSides(banks:readonly ExactMoney[],zens:ReadonlyMap<string,ExactMoney>,preferred:ReadonlyMap<number,ReadonlySet<string>>=new Map()){
  const remaining=new Map(zens),matched=new Set<number>(),unmatched:{index:number;amount:ExactMoney}[]=[];
  for(let i=0;i<banks.length;i++)for(const [key,value]of remaining){
    if(value.equals(banks[i])&&preferred.get(i)?.has(key)){remaining.delete(key);matched.add(i);break;}
  }
  for(let i=0;i<banks.length;i++){
    if(matched.has(i))continue;let found=false;
    for(const [key,value]of remaining)if(value.equals(banks[i])){remaining.delete(key);found=true;break;}
    if(!found)unmatched.push({index:i,amount:banks[i]});
  }
  let budget=20000;const missing=new Set(unmatched.map(row=>row.index));
  for(const {index,amount}of unmatched){
    const choices=[...remaining].filter(([,value])=>value.sign()!==0&&value.sign()===amount.sign()&&absolute(value).compare(absolute(amount))<0);
    if(choices.length>16)continue;
    const solutions:string[][]=[];let exhausted=false;
    function visit(i:number,total:ExactMoney,ids:string[]){
      if(budget<=0){exhausted=true;return;}budget--;
      if(solutions.length>1)return;
      if(total.equals(absolute(amount))){if(ids.length>1)solutions.push(ids);return;}
      if(i===choices.length||total.compare(absolute(amount))>0)return;
      const [key,value]=choices[i];visit(i+1,total.add(absolute(value)),[...ids,key]);visit(i+1,total,ids);
    }
    visit(0,zero(),[]);
    if(solutions.length===1&&!exhausted){missing.delete(index);for(const key of solutions[0])remaining.delete(key);}
  }
  return {missing,extras:new Set(remaining.keys())};
}
