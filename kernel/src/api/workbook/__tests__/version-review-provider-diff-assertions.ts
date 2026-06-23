import { expect } from '@jest/globals';

export function expectUnsupportedAuthoredDomainDetailsRedacted(serialized: string): void {
  expect(serialized).not.toContain('principal-secret');
  expect(serialized).not.toContain('deniedPrincipal');
  expect(serialized).not.toContain('macros.vba');
  expect(serialized).not.toContain('module-1');
  expect(serialized).not.toContain('private macro source');
  expect(serialized).not.toContain('changes[1]');
}
