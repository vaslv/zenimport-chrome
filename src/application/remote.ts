/** The only translation from named application operations to legacy API paths. */
import type {ApplicationService,Transport} from './service.js';
const key=(value:string)=>encodeURIComponent(value);
export function remoteService(transport:Transport):ApplicationService{
  const request=<T>(path:string,method?:string,body?:unknown)=>transport.request(path,method,body) as Promise<T>;
  return {
    capabilities:()=>transport.info() as ReturnType<ApplicationService['capabilities']>,
    connections:{
      list:bank=>request('/connections?bank='+key(bank)),get:id=>request('/connections/'+key(id)),
      discover:data=>request('/connections/discover','POST',data),
      rename:(id,data)=>request('/connections/'+key(id)+'/label','PUT',data),
      unlink:(id,account)=>request('/connections/'+key(id)+'/accounts/'+key(account)+'/unlink','POST',{}),
    },
    accounts:{catalog:()=>request('/zenmoney/accounts'),configure:(id,data)=>request('/accounts/'+key(id)+'/settings','PUT',data)},
    capture:{
      start:data=>request('/jobs','POST',data),get:id=>request('/jobs/'+key(id)),
      lease:(id,data)=>request('/jobs/'+key(id)+'/lease','POST',data),
      page:(id,interval,number,data)=>request('/jobs/'+key(id)+'/intervals/'+key(interval)+'/pages/'+number,'PUT',data),
      complete:(id,interval,data)=>request('/jobs/'+key(id)+'/intervals/'+key(interval)+'/complete','POST',data),
      pause:(id,data)=>request('/jobs/'+key(id)+'/capture-status','POST',data),stop:id=>request('/jobs/'+key(id)+'/stop','POST',{}),
    },
    reports:{discrepancies:(id,query)=>{
      const values=new URLSearchParams();
      for(const field of ['from_date','to_date','account_id'] as const)if(query[field])values.set(field,query[field]!);
      if(query.refresh)values.set('refresh','true');return request('/connections/'+key(id)+'/discrepancies?'+values);
    }},
    migration:{status:()=>request('/migration/status'),resume:()=>request('/migration/resume','POST',{}),
      export:()=>transport.transfer('export') as Promise<Blob>,import:file=>transport.transfer('import',file)},
  };
}
