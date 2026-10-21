import {DomainError} from '../domain/errors.js';
import {ExactMoney, signedMovement} from '../domain/money.js';
import type {Movement} from '../domain/money.js';
import {normalized, recipient} from '../domain/identity.js';
import {calendarDate, localDay, shiftMonths} from '../domain/dates.js';
import {canonicalDto, dtoDigest, moneyFromWire, rawRoundtrip} from '../domain/codec.js';
import {ExactDecimal} from 'zenmoney-typescript';
import {FixtureContext} from './context.js';
import {plannedRanges,frontier,mergeRanges,chunks,subtractRange} from '../domain/periods.js';
import type {DayRange} from '../domain/periods.js';

export interface Scenario {
  contract_version: number; id: string; implemented_by_stage: string; clock: string;
  uuids: string[]; initial_state: Record<string, unknown>;
  commands: {operation: string; input: Record<string, unknown>; fault?: string}[];
  expected: {results: unknown[]; external_writes: unknown[]; state_assertions: unknown[]};
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('invalid_dto');
  return value;
}

/** Strict dispatch: future engine commands fail instead of appearing to pass. */
export async function execute(operation: string, input: Record<string, unknown>): Promise<unknown> {
  switch (operation) {
    case 'money.sum': {
      if (!Array.isArray(input.values) || input.values.length > 100000) throw new DomainError('invalid_dto');
      return ExactMoney.sum(input.values.map(value => ExactMoney.parse(text(value)))).toString();
    }
    case 'money.compare': return ExactMoney.parse(text(input.left)).compare(ExactMoney.parse(text(input.right)));
    case 'money.subtract': return ExactMoney.parse(text(input.left)).subtract(ExactMoney.parse(text(input.right))).toString();
    case 'money.sign': return ExactMoney.parse(text(input.value)).sign();
    case 'money.bank': return ExactMoney.bank(text(input.value), input.scale as number | undefined).toString();
    case 'money.wire': {
      let value: ExactDecimal;
      try { value = new ExactDecimal(text(input.value)); }
      catch { throw new DomainError('invalid_amount'); }
      return moneyFromWire(value).toString();
    }
    case 'movement.signed': {
      const result = signedMovement(input.transaction as Movement, text(input.target), text(input.instrument));
      return result?.toString() ?? null;
    }
    case 'identity.normalize': return normalized(text(input.value));
    case 'identity.recipient': return recipient(input.row as Parameters<typeof recipient>[0]);
    case 'dates.calendar': return calendarDate(text(input.value));
    case 'dates.localDay': return localDay(text(input.value), text(input.timezone));
    case 'dates.months': return shiftMonths(text(input.value), input.delta as number);
    case 'capture.periods': {
      const start=text(input.start),end=text(input.end),coverage=input.coverage as DayRange[],forced=input.forced===null?null:text(input.forced);
      const planned=plannedRanges(start,end,coverage,forced),merged=mergeRanges([...planned,...(input.outstanding as DayRange[])]);
      return {frontier:frontier(start,coverage),planned,merged,chunks:chunks(merged,input.days as number),remaining:subtractRange(input.outstanding as DayRange[],start,end)};
    }
    case 'wire.canonical': return canonicalDto(input.value);
    case 'wire.digest': return dtoDigest(input.value);
    case 'wire.roundtrip': return rawRoundtrip(text(input.value));
    default: throw new DomainError('unsupported_command');
  }
}

export async function runScenario(scenario: Scenario) {
  const context = new FixtureContext(scenario.clock, scenario.uuids);
  if (scenario.contract_version !== 1 || Object.keys(scenario.initial_state).length ||
      scenario.expected.state_assertions.length || context.remaining)
    throw new DomainError('unsupported_scenario');
  const results: unknown[] = [];
  for (const command of scenario.commands) {
    if (command.fault && command.fault !== 'none') throw new DomainError('unsupported_scenario');
    try { results.push(await execute(command.operation, command.input)); }
    catch (error) {
      if (!(error instanceof DomainError) || ['unsupported_command', 'unsupported_scenario'].includes(error.code)) throw error;
      results.push({error: error.code});
    }
  }
  return {results, external_writes: [], state_assertions: []};
}

export {DomainError, ExactMoney, signedMovement, normalized, recipient, calendarDate, localDay, shiftMonths,
  canonicalDto, dtoDigest, moneyFromWire, rawRoundtrip, FixtureContext};

// Private native domain adapters; never included as a product RPC surface.
export {uniqueSubset,unmatchedSides} from '../domain/reconciliation/subsets.js';
export {singleMatches,groupMatches} from '../domain/reconciliation/matching.js';
export {backfillOwnership,recoverTransferOwnership,blockedOwnership,ownershipClaims} from '../domain/reconciliation/ownership.js';
export {buildCategoryEvidence,categoryContext,predictCategory} from '../domain/prediction/categories.js';
// Private contract adapters; this runner is excluded from the product bundle.
export {categoryPlan} from '../local/reconciliation/categories.js';
export {sourceFacts} from '../local/reconciliation/facts.js';

export {authorizeJob} from '../local/delivery/authorization.js';
