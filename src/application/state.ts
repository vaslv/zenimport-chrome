/** Context-scoped transient state; top-level keys are a compatibility projection. */
export interface StorageArea{
  get(keys:string|readonly string[]|null):Promise<Record<string,unknown>>;
  set(values:Record<string,unknown>):Promise<void>;
  remove(keys:string|readonly string[]):Promise<void>;
  setAccessLevel(options:{accessLevel:'TRUSTED_CONTEXTS'}):Promise<void>;
}
const defaults={view:null,capture:null,reimportFrom:null,reimportDates:{},syncHistory:{},profiles:{},selectedProfiles:{},creatingProfiles:{}};
type State=Record<keyof typeof defaults,unknown>;
export class ScopedState{
  constructor(private area:StorageArea,private id:string,private url:string,private legacy:boolean,private assert:()=>Promise<void>,
    private owner:{read():Promise<Record<string,unknown>|null>;patch(values:Record<string,unknown>,initialize?:boolean):Promise<Record<string,unknown>>}){}
  async hydrate(){
    await this.assert();const values=await this.area.get(['applicationStateContext',...Object.keys(defaults)]);
    let state=await this.owner.read();
    if(!state){
      state=structuredClone(defaults);
      if(this.legacy&&values.applicationStateContext===undefined){
        for(const key of Object.keys(defaults) as (keyof State)[])if(values[key]!==undefined)state[key]=values[key];
        for(const key of ['profiles','selectedProfiles','creatingProfiles','reimportDates','syncHistory'] as const)
          state[key]=Object.fromEntries(Object.entries(state[key] as Record<string,unknown>).filter(([key])=>key.startsWith(this.url+'|')));
      }
      state=await this.owner.patch(state,true);
    }
    if(values.applicationStateContext!==this.id){await this.assert();await this.area.set({applicationStateContext:this.id,...state});await this.assert();}
    return state;
  }
  async get(keys:string|readonly string[]){
    const state=await this.hydrate();
    await this.assert();return Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,state[key as keyof State]]));
  }
  async set(values:Record<string,unknown>){
    if(!Object.keys(values).every(key=>Object.hasOwn(defaults,key)))throw Error('Unsupported scoped state');
    await this.hydrate();const state=await this.owner.patch(values);
    await this.assert();await this.area.set({applicationStateContext:this.id,...state});await this.assert();
  }
  async remove(keys:string|readonly string[]){
    await this.set(Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,structuredClone(defaults[key as keyof State])])));
  }
}
