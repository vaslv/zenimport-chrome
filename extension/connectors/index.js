import * as vietinbank from './vietinbank/index.js';
export const connectors = [vietinbank];
export function connectorFor(url) { return connectors.find(item => item.supports(url)); }
export function connectorById(id) { return connectors.find(item => item.id === id); }
