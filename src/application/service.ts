/** Transport-independent application boundary. All identifiers remain DTO values. */
import type * as DTO from './dto.js';
export interface MigrationStatus{
  format_version:number;can_import:boolean;paused:boolean;awaiting_sync:boolean;
  imported_sha256:string|null;max_archive_bytes:number;
}
export interface DiscrepancyQuery{from_date?:string;to_date?:string;account_id?:string;refresh?:boolean}
export interface ApplicationService{
  capabilities():Promise<DTO.ServerInfo>;
  connections:{list(bank:string):Promise<DTO.ConnectionCatalog>;get(id:string):Promise<DTO.ConnectionView>;
    discover(data:DTO.DiscoverConnection):Promise<DTO.ConnectionView>;rename(id:string,data:DTO.ConnectionLabel):Promise<DTO.ConnectionView>;
    unlink(id:string,accountId:string):Promise<DTO.ConnectionView>};
  accounts:{catalog():Promise<DTO.AccountCatalog>;configure(id:string,data:DTO.AccountSettings):Promise<DTO.AccountView>};
  capture:{start(data:DTO.StartSync):Promise<DTO.JobView>;get(id:string):Promise<DTO.JobView>;
    lease(id:string,data:DTO.CaptureLeaseRequest):Promise<DTO.CaptureLease>;
    page(id:string,interval:string,number:number,data:DTO.CapturePage):Promise<DTO.PageReceipt>;
    complete(id:string,interval:string,data:DTO.CaptureComplete):Promise<DTO.IntervalView>;
    pause(id:string,data:DTO.CaptureStatus):Promise<DTO.JobView>;stop(id:string):Promise<DTO.JobView>};
  reports:{discrepancies(id:string,query:DiscrepancyQuery):Promise<DTO.DiscrepancyReport>};
  migration:{status():Promise<MigrationStatus>;resume():Promise<unknown>;export():Promise<Blob>;import(file:Blob):Promise<unknown>};
}
export interface ApplicationContext{
  operation_id:string;dataset_id:string;generation:string;mode:'local'|'remote';mode_epoch:string;credential_epoch:string;
}
export interface Transport{
  info():Promise<unknown>;
  request(path:string,method?:string,body?:unknown):Promise<unknown>;
  transfer(action:'export'|'import',file?:Blob):Promise<unknown>;
}
