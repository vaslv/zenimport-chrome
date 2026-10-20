import {ExactDecimal} from 'zenmoney-typescript';
import {DomainError} from './errors.js';

/** Preserve Decimal's quantum/sign and scientific notation in mirror TEXT.
 * This is not a monetary formatter: matching arithmetic uses ExactMoney.
 */
export function pythonDecimalText(value:ExactDecimal):string{
  const lexeme=value.toString(),negative=lexeme.startsWith('-');
  const [mantissa,exponent='0']=lexeme.replace(/^-/,'').toLowerCase().split('e');
  const [integer,fraction='']=mantissa.split('.'),digits=(integer+fraction).replace(/^0+/,'')||'0';
  const scale=BigInt(exponent)-BigInt(fraction.length),adjusted=scale+BigInt(digits.length)-1n;
  let result:string;
  if(scale<=0n&&adjusted>=-6n){
    const point=Number(BigInt(digits.length)+scale); // Bounded by coefficient length and six leading zeroes.
    result=point<=0?'0.'+'0'.repeat(-point)+digits:point===digits.length?digits:digits.slice(0,point)+'.'+digits.slice(point);
  }else result=digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'E'+(adjusted>=0n?'+':'')+adjusted;
  return (negative?'-':'')+result;
}

export function mirrorAmountText(value:unknown):string|null{
  if(value===null||value===undefined)return null;
  if(typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='bigint'){
    if(value<0)throw new DomainError('invalid_amount');return String(value);
  }
  if(!(value instanceof ExactDecimal)||value.compare(new ExactDecimal('0'))<0)throw new DomainError('invalid_amount');
  return pythonDecimalText(value);
}

export function mirrorFlagText(value:unknown):string|null{
  if(value===null||value===undefined)return null;
  if(value===false||value===0||value===0n)return '0';
  if(value===true||value===1||value===1n)return '1';
  throw new DomainError('invalid_dto');
}
