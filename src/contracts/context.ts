import {DomainError} from '../domain/errors.js';

/** Deterministic dependencies for later stateful adapters; no host clock/random. */
export class FixtureContext {
  readonly now: bigint;
  private readonly ids: string[];
  private index = 0;
  constructor(clock: string, ids: string[]) {
    if (typeof clock !== 'string' || clock.length > 32 || clock.match(/^(0|[1-9][0-9]*)$/)?.[0] !== clock ||
        ids.some(id => id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)?.[0] !== id) || new Set(ids).size !== ids.length)
      throw new DomainError('unsupported_scenario');
    this.now = BigInt(clock); this.ids = [...ids];
  }
  nextUUID(): string {
    if (this.index >= this.ids.length) throw new DomainError('unsupported_scenario');
    return this.ids[this.index++];
  }
  get remaining(): number { return this.ids.length - this.index; }
}
