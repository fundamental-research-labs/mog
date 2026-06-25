import {
  canonicalizeVersionDependencies,
  parseWorkbookCommitId,
  versionDependencySortKey,
  type VersionDependencyRef,
} from '../object-digest';
import { HEX_A, HEX_B, HEX_C, digest, expectIssue } from './object-digest-test-helpers';

export function registerCanonicalizeVersionDependenciesTests(): void {
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
}
