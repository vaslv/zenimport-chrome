/** Alarms are wakeups only; native durable leases remain the financial owner. */
export interface DeliveryAlarmPort{
  get(name:string):Promise<{name:string;scheduledTime:number;periodInMinutes?:number}|undefined>;
  create(name:string,options:{when:number;periodInMinutes:number}):Promise<void>;
  clear(name:string):Promise<boolean>;
}
export const DELIVERY_ALARM='zenimport-local-delivery';
export class DeliveryAlarms{
  private pending:Promise<void>|null=null;
  private requested=0;
  private completed=0;
  constructor(private alarms:DeliveryAlarmPort,private resolve:()=>Promise<{next():Promise<string|null>;run():Promise<unknown>}|null>,private clock:()=>number=()=>Date.now()/1000){}
  async restore(){
    const ticket=++this.requested;
    while(this.completed<ticket){
      if(!this.pending)this.pending=(async()=>{
        while(this.completed<this.requested){const seen=this.requested;await this.#restore();this.completed=seen;}
      })().finally(()=>{this.pending=null;});
      await this.pending;
    }
  }
  async #restore(){
    const worker=await this.resolve();
    if(!worker){await this.alarms.clear(DELIVERY_ALARM);return;}
    const next=await worker.next(),now=this.clock();
    // A periodic watchdog already exists before run: worker death cannot lose
    // the sole one-shot alarm. Idle wakeups inspect local work without API calls.
    const when=Math.max(now+30,Math.min(Number(next??now+30),now+300))*1000,existing=await this.alarms.get(DELIVERY_ALARM);
    if(!existing||existing.periodInMinutes!==.5||existing.scheduledTime>when+1000)await this.alarms.create(DELIVERY_ALARM,{when,periodInMinutes:.5});
  }
  async wake(name=DELIVERY_ALARM){
    if(name!==DELIVERY_ALARM)return;
    await this.restore();
    try{
      const worker=await this.resolve();if(!worker)return;
      const start=this.clock();
      for(let unit=0;unit<3;unit++){
        const next=await worker.next();if(next===null||BigInt(next)>BigInt(Math.floor(this.clock())))break;
        await worker.run();if(this.clock()-start>=25)break;
      }
    }finally{await this.restore();}
  }
}
