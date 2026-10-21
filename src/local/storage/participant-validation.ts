import {participantInteger,participantUuid} from '../../control/participant-wire.js';
import type {ParticipantControl} from './participant-model.js';
import {requireStorage} from './types.js';

export function participantControl(input:unknown):ParticipantControl{
  try{
    requireStorage(input!==null&&typeof input==='object'&&!Array.isArray(input),'storage_corrupt');
    const row=input as Record<string,unknown>,keys=['id','generation','epoch','state','operationId','everActivated','awaitingSync'];
    requireStorage(Object.keys(row).length===keys.length&&keys.every(key=>Object.hasOwn(row,key)),'storage_corrupt');
    participantUuid(row.id);participantUuid(row.generation);participantInteger(row.epoch);
    requireStorage(typeof row.state==='string'&&['active','export_hold','import_hold','armed','cancel_pending','handed_off'].includes(row.state),'storage_corrupt');
    requireStorage(typeof row.everActivated==='boolean'&&typeof row.awaitingSync==='boolean'&&(!row.awaitingSync||row.everActivated),'storage_corrupt');
    if(row.operationId!==null)participantUuid(row.operationId);
    requireStorage((row.state==='active')===(row.operationId===null),'storage_corrupt');return row as unknown as ParticipantControl;
  }catch{requireStorage(false,'storage_corrupt');}
}
