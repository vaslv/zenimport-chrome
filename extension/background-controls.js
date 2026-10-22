/** Control wakeups resume durable intents; they never grant consent or send money. */
import {controlStatus,controlCommand} from '../src/application/control-api.ts';
export const CONTROL_ALARM='zenimport-storage-control';
const PAUSE_KEY='storageControlPause';
export function nextControl(storage){
  const transfer=storage.controls.transfer,join=storage.controls.join,a=storage.archives;
  if(transfer&&!['complete','cancelled'].includes(transfer.phase))return {type:'storage-step',id:transfer.id};
  if(join?.phase==='quiescing')return {type:'storage-step',id:join.id};
  if(a.recovery&&(a.recovery.phase==='pending'||a.recovery.cleaning)){
    if(a.recovery.awaitingConfirmation)return null;
    return {type:'archive-import-step',target:'server',id:a.recovery.id};
  }
  if(a.restore&&['loading','validated'].includes(a.restore.phase))return {type:'archive-import-step',target:'browser',id:a.restore.id};
  const backup=a.backup;
  if(backup&&backup.phase!=='complete'&&(backup.phase!=='ready'||backup.ackRequested||backup.cancelRequested))return {type:'archive-export-step',kind:'remote',id:backup.id};
  const local=a.backups.find(value=>value.phase==='building')??(a.preparation?.phase==='quiescing'?a.preparation:null);
  if(local)return {type:'archive-export-step',kind:'local',id:local.id};
  return null;
}
export class ControlAlarms{
  constructor(runtime,area,alarms,clock=()=>Date.now()/1000){Object.assign(this,{runtime,area,alarms,clock});}
  async pause(){return (await this.area.get(PAUSE_KEY))[PAUSE_KEY]??null;}
  async retry(){await this.area.remove(PAUSE_KEY);await this.arm();}
  async arm(){if(!await this.alarms.get(CONTROL_ALARM))await this.alarms.create(CONTROL_ALARM,{periodInMinutes:.5});}
  async pending(){
    const app=await this.runtime.current();if(!app)return null;
    const command=nextControl(await controlStatus(this.runtime,app));if(!command)return null;
    const paused=await this.pause();return paused?.id===command.id?null:{app,command};
  }
  async restore(){if(await this.pending())await this.arm();else await this.alarms.clear(CONTROL_ALARM);}
  async wake(){
    // Arm before dispatch. Termination after a native commit still has a wakeup.
    await this.arm();const started=this.clock();
    try{
      for(let n=0;n<16;n++){
        const work=await this.pending();if(!work)break;
        let result;
        try{({result}=await controlCommand(work.command,this.runtime,work.app));}
        catch(error){
          // A changed Root is re-read, never repaired from an old callback.
          if(['stale_context','stale_epoch'].includes(error.code))break;
          await work.app.assert(true);
          await this.area.set({[PAUSE_KEY]:{id:work.command.id,error:stableControlError(error.code)}});break;
        }
        if(result?.state==='blocked'){
          await work.app.assert(true);
          await this.area.set({[PAUSE_KEY]:{id:work.command.id,error:stableControlError(result.error??result.code)}});break;
        }
        if(['waiting','busy','preview','download'].includes(result?.state)||this.clock()-started>=25)break;
      }
    }finally{await this.restore();}
  }
}
const errors=new Set(['migration_busy','migration_paused','migration_not_empty','migration_invalid','migration_wrong_account','migration_incomplete','zenmoney_unavailable','backend_unavailable','unauthorized','permission_required','zenmoney_permission','quota_exceeded','recovery_required']);
function stableControlError(code){return errors.has(code)?code:'migration_invalid';}
