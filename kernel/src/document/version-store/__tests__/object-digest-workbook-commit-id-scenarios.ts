import {
  isWorkbookCommitId,
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
} from '../object-digest';
import { HEX_A, digest, expectIssue } from './object-digest-test-helpers';

export function registerWorkbookCommitIdGrammarTests(): void {
  it('parses and guards commit IDs backed by sha256 object digests', () => {
    const commitId = parseWorkbookCommitId(`commit:sha256:${HEX_A}`);

    expect(commitId).toBe(`commit:sha256:${HEX_A}`);
    expect(isWorkbookCommitId(commitId)).toBe(true);
    expect(objectDigestFromWorkbookCommitId(commitId)).toEqual(digest(HEX_A));
    expect(workbookCommitIdFromObjectDigest(digest(HEX_A))).toBe(commitId);
  });

  it.each([
    ['uppercase hex', `commit:sha256:${HEX_A.toUpperCase()}`],
    ['base64-like digest', `commit:sha256:${'a'.repeat(43)}=`],
    ['wrong length', `commit:sha256:${'0'.repeat(63)}`],
    ['unknown algorithm', `commit:sha512:${HEX_A}`],
    ['untagged digest', HEX_A],
    ['namespace-qualified id', `doc-1/graph-1/commit:sha256:${HEX_A}`],
    ['object value', { algorithm: 'sha256', digest: HEX_A }],
  ])('rejects invalid WorkbookCommitId grammar: %s', (_label, value) => {
    expect(isWorkbookCommitId(value)).toBe(false);
    expectIssue(() => parseWorkbookCommitId(value), 'VERSION_INVALID_COMMIT_ID');
  });
}
