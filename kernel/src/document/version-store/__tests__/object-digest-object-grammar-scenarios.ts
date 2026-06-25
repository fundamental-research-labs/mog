import { VersionObjectDigestError, isObjectDigest, parseObjectDigest } from '../object-digest';
import { HEX_A, digest } from './object-digest-test-helpers';

export function registerObjectDigestGrammarTests(): void {
  it('parses and guards strict sha256 object digests', () => {
    const parsed = parseObjectDigest(digest(HEX_A));

    expect(parsed).toEqual({ algorithm: 'sha256', digest: HEX_A });
    expect(isObjectDigest(parsed)).toBe(true);
  });

  it.each([
    ['uppercase hex', { algorithm: 'sha256', digest: HEX_A.toUpperCase() }],
    ['base64-like digest', { algorithm: 'sha256', digest: `${'a'.repeat(43)}=` }],
    ['wrong length', { algorithm: 'sha256', digest: '0'.repeat(63) }],
    ['unknown algorithm', { algorithm: 'sha512', digest: HEX_A }],
    ['extra fields', { algorithm: 'sha256', digest: HEX_A, namespace: 'doc-1' }],
    ['untagged string', HEX_A],
    ['tagged digest string', `sha256:${HEX_A}`],
    ['namespace-qualified string', `doc-1/graph-1/sha256:${HEX_A}`],
  ])('rejects invalid ObjectDigest grammar: %s', (_label, value) => {
    expect(isObjectDigest(value)).toBe(false);
    expect(() => parseObjectDigest(value)).toThrow(VersionObjectDigestError);
  });
}
