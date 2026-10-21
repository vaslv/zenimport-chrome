/** One privileged initialization lane for each physical IDB name. */
const opening=new Map<string,Promise<void>>();
export async function serializeOpen<T>(name:string,operation:()=>Promise<T>):Promise<T>{
  const previous=opening.get(name)??Promise.resolve();let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});opening.set(name,current);await previous;
  try{return await operation();}finally{release();if(opening.get(name)===current)opening.delete(name);}
}
