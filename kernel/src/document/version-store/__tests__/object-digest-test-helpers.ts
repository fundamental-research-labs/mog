import { VersionObjectDigestError, type ObjectDigest } from '../object-digest';

export const HEX_A = 'aa'.repeat(32);
export const HEX_B = '11'.repeat(32);
export const HEX_C = '22'.repeat(32);

export function digest(hex: string): ObjectDigest {
  return { algorithm: 'sha256', digest: hex };
}

export function expectIssue(fn: () => unknown, issue: string): void {
  try {
    fn();
    throw new Error('expected function to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(VersionObjectDigestError);
    expect((error as VersionObjectDigestError).issue).toBe(issue);
  }
}
