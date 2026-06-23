import { expect } from '@jest/globals';

export function expectPublicDiagnosticsNotToLeak(
  result: unknown,
  forbidden: readonly string[],
): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}
