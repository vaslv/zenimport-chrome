/** Local counters and SDK identifiers retain exact decimal text at the facade. */
import type * as Wire from './dto.generated.js';
type ExactKey='settings_version'|'expected_version'|'lease_epoch'|'epoch'|'instrument'|'created';
type Exact<T>=T extends readonly (infer V)[]?Exact<V>[]:T extends object?{
  [K in keyof T]:K extends ExactKey?Exact<T[K]>|(Extract<T[K],number> extends never?never:string):Exact<T[K]>
}:T;
export type AccountCatalog = Exact<Wire.AccountCatalog>;
export type AccountProgress = Exact<Wire.AccountProgress>;
export type AccountSettings = Exact<Wire.AccountSettings>;
export type AccountView = Exact<Wire.AccountView>;
export type ApiError = Exact<Wire.ApiError>;
export type BankRecord = Exact<Wire.BankRecord>;
export type Capabilities = Exact<Wire.Capabilities>;
export type CaptureComplete = Exact<Wire.CaptureComplete>;
export type CaptureLease = Exact<Wire.CaptureLease>;
export type CaptureLeaseRequest = Exact<Wire.CaptureLeaseRequest>;
export type CapturePage = Exact<Wire.CapturePage>;
export type CaptureStatus = Exact<Wire.CaptureStatus>;
export type ConnectionCatalog = Exact<Wire.ConnectionCatalog>;
export type ConnectionLabel = Exact<Wire.ConnectionLabel>;
export type ConnectionView = Exact<Wire.ConnectionView>;
export type DateRange = Exact<Wire.DateRange>;
export type DeliveryCounts = Exact<Wire.DeliveryCounts>;
export type DifferenceDay = Exact<Wire.DifferenceDay>;
export type DiscoverConnection = Exact<Wire.DiscoverConnection>;
export type DiscoveredAccount = Exact<Wire.DiscoveredAccount>;
export type DiscrepancyReport = Exact<Wire.DiscrepancyReport>;
export type ErrorResponse = Exact<Wire.ErrorResponse>;
export type ExtraOperation = Exact<Wire.ExtraOperation>;
export type IntervalView = Exact<Wire.IntervalView>;
export type JobView = Exact<Wire.JobView>;
export type PageReceipt = Exact<Wire.PageReceipt>;
export type ReportAccount = Exact<Wire.ReportAccount>;
export type ServerInfo = Exact<Wire.ServerInfo>;
export type StartSync = Exact<Wire.StartSync>;
export type ZenAccount = Exact<Wire.ZenAccount>;
