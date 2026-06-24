import { compareTombstoneRefs } from '../refs/ref-store-ordering';
import { tombstoneFixture } from './ref-store-test-helpers';

export const registerRefStoreTombstoneOrderingScenarios = (): void => {
  it('keeps tombstone sorting deterministic when a persisted timestamp is malformed', () => {
    const valid = tombstoneFixture('scenario/valid', '2026-06-20T00:00:00.000Z');
    const invalidA = tombstoneFixture('scenario/a', 'invalid');
    const invalidB = tombstoneFixture('scenario/b', 'invalid');

    expect(compareTombstoneRefs(valid, invalidA)).toBeLessThan(0);
    expect(compareTombstoneRefs(invalidA, valid)).toBeGreaterThan(0);
    expect([invalidB, invalidA].sort(compareTombstoneRefs).map((record) => record.name)).toEqual([
      'scenario/a',
      'scenario/b',
    ]);
  });
};
