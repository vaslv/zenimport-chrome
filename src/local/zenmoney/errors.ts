/** Only stable, redacted codes may cross an application boundary. */
import {HTTPError,ResponseError,TransportError,ValidationError} from 'zenmoney-typescript';
export type ZenMoneyCode='zenmoney_not_configured'|'zenmoney_auth'|'zenmoney_permission'|'zenmoney_rate_limited'|
  'zenmoney_unavailable'|'zenmoney_response'|'zenmoney_wrong_owner'|'mirror_busy'|'mirror_cooldown';
export class LocalZenMoneyError extends Error{
  constructor(readonly code:ZenMoneyCode){super(code);this.name='LocalZenMoneyError';}
}
export function zenmoneyFailure(error:unknown):LocalZenMoneyError{
  if(error instanceof LocalZenMoneyError)return error;
  return new LocalZenMoneyError(error instanceof HTTPError?(error.statusCode===401||error.statusCode===403?'zenmoney_auth':
    error.statusCode===429?'zenmoney_rate_limited':error.statusCode>=500?'zenmoney_unavailable':'zenmoney_response'):
    error instanceof TransportError?'zenmoney_unavailable':error instanceof ResponseError||error instanceof ValidationError?'zenmoney_response':'zenmoney_unavailable');
}
