/**
 * Deterministic ID generation for test host fixtures.
 *
 * Every generator produces predictable, monotonically increasing IDs
 * with zero randomness. Tests can reset generators to reproduce exact
 * sequences across runs.
 */

export interface DeterministicIdGenerator {
  next(): string;
  reset(): void;
  readonly count: number;
}

export function createDeterministicIdGenerator(prefix: string): DeterministicIdGenerator {
  let counter = 0;
  return {
    next(): string {
      return `${prefix}-${String(++counter).padStart(8, '0')}`;
    },
    reset(): void {
      counter = 0;
    },
    get count(): number {
      return counter;
    },
  };
}

export interface DeterministicIds {
  readonly decisions: DeterministicIdGenerator;
  readonly correlations: DeterministicIdGenerator;
  readonly nonces: DeterministicIdGenerator;
  readonly providerRefs: DeterministicIdGenerator;
  readonly sessions: DeterministicIdGenerator;
  readonly sourceHandles: DeterministicIdGenerator;
  readonly exports: DeterministicIdGenerator;
}

export function createDeterministicIds(): DeterministicIds {
  return {
    decisions: createDeterministicIdGenerator('decision'),
    correlations: createDeterministicIdGenerator('correlation'),
    nonces: createDeterministicIdGenerator('nonce'),
    providerRefs: createDeterministicIdGenerator('provider-ref'),
    sessions: createDeterministicIdGenerator('session'),
    sourceHandles: createDeterministicIdGenerator('source-handle'),
    exports: createDeterministicIdGenerator('export'),
  };
}
