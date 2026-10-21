/** Internal durable-writer states; no financial input or HTTP details in errors. */
export type DeliveryCode='delivery_busy'|'delivery_unknown';
export class DeliveryError extends Error{
  constructor(readonly code:DeliveryCode){super(code);this.name='DeliveryError';}
}
