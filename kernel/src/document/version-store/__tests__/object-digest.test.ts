import {
  VersionObjectDigestError,
  canonicalizeVersionDependencies,
  isObjectDigest,
  isWorkbookCommitId,
  objectDigestFromWorkbookCommitId,
  parseObjectDigest,
  parseWorkbookCommitId,
  versionDependencySortKey,
  workbookCommitIdFromObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
} from '../object-digest';

const HEX_A = 'aa'.repeat(32);
const HEX_B = '11'.repeat(32);
const HEX_C = '22'.repeat(32);

function digest(hex: string): ObjectDigest {
  return { algorithm: 'sha256', digest: hex };
}

function expectIssue(fn: () => unknown, issue: string): void {
  try {
    fn();
    throw new Error('expected function to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(VersionObjectDigestError);
    expect((error as VersionObjectDigestError).issue).toBe(issue);
  }
}

describe('version object digest grammar', () => {
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
});

describe('workbook commit id grammar', () => {
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
});

describe('canonicalizeVersionDependencies', () => {
  const commitA = parseWorkbookCommitId(`commit:sha256:${HEX_A}`);
  const commitDependency: VersionDependencyRef = {
    kind: 'commit',
    commitId: commitA,
    digest: digest(HEX_A),
  };
  const semanticDependency: VersionDependencyRef = {
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: digest(HEX_B),
  };
  const snapshotDependency: VersionDependencyRef = {
    kind: 'object',
    objectType: 'workbook.snapshotRoot.v1',
    digest: digest(HEX_C),
  };

  it('sorts dependencies by kind, object type, digest algorithm, digest, and commit id', () => {
    const canonical = canonicalizeVersionDependencies([
      snapshotDependency,
      semanticDependency,
      commitDependency,
    ]);

    expect(canonical).toEqual([
      commitDependency,
      semanticDependency,
      snapshotDependency,
    ] satisfies readonly VersionDependencyRef[]);
  });

  it('produces stable canonical ordering independent of input order', () => {
    const first = canonicalizeVersionDependencies([
      snapshotDependency,
      semanticDependency,
      commitDependency,
    ]);
    const second = canonicalizeVersionDependencies([
      commitDependency,
      snapshotDependency,
      semanticDependency,
    ]);

    expect(first.map(versionDependencySortKey)).toEqual(second.map(versionDependencySortKey));
  });

  it('rejects duplicate canonical dependency refs', () => {
    expectIssue(
      () =>
        canonicalizeVersionDependencies([
          semanticDependency,
          { ...semanticDependency, digest: { ...semanticDependency.digest } },
        ]),
      'VERSION_DUPLICATE_DEPENDENCY',
    );
  });

  it('rejects commit dependencies whose digest disagrees with the commit id', () => {
    expectIssue(
      () =>
        canonicalizeVersionDependencies([
          {
            kind: 'commit',
            commitId: commitA,
            digest: digest(HEX_B),
          },
        ]),
      'VERSION_DIGEST_MISMATCH',
    );
  });

  it('rejects dependency refs with unsupported object types or extra fields', () => {
    expectIssue(
      () =>
        canonicalizeVersionDependencies([
          {
            kind: 'object',
            objectType: 'workbook.unknown.v1',
            digest: digest(HEX_A),
          },
        ]),
      'VERSION_UNSUPPORTED_OBJECT_TYPE',
    );

    expectIssue(
      () =>
        canonicalizeVersionDependencies([
          {
            ...snapshotDependency,
            storageKey: 'not-in-preimage',
          },
        ]),
      'VERSION_INVALID_DEPENDENCY',
    );
  });
});
