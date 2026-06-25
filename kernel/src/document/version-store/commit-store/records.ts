import {
  objectDigestFromWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from '../object-digest';
import { dependencyKey } from './utils';
import { dependenciesForPayload, diagnostic, parseCommitPayload } from './payload';
import {
  VersionObjectStoreError,
  type InMemoryVersionObjectStore,
  type VersionObjectRecord,
} from '../object-store';
import type { WorkbookCommit, WorkbookCommitPayload, WorkbookCommitStoreDiagnostic } from './types';

export function validateCommitRecord(
  commitId: WorkbookCommitId,
  record: VersionObjectRecord<WorkbookCommitPayload>,
  expectedDocumentId: string,
): readonly WorkbookCommitStoreDiagnostic[] {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const expectedDigest = objectDigestFromWorkbookCommitId(commitId);

  if (record.preimage.objectType !== 'workbook.commit.v1') {
    diagnostics.push(
      diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit id resolved to a non-commit object.', {
        commitId,
        objectDigest: record.digest,
        details: { objectType: record.preimage.objectType },
      }),
    );
  }
  if (record.digest.digest !== expectedDigest.digest) {
    diagnostics.push(
      diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id digest does not match commit object.', {
        commitId,
        objectDigest: record.digest,
        details: { expectedDigest: expectedDigest.digest, receivedDigest: record.digest.digest },
      }),
    );
  }

  const payloadResult = parseCommitPayload(record.preimage.payload);
  if (!payloadResult.ok) {
    diagnostics.push(...payloadResult.diagnostics);
    return diagnostics;
  }

  const payload = payloadResult.payload;
  if (payload.documentId !== expectedDocumentId) {
    diagnostics.push(
      diagnostic('VERSION_WRONG_DOCUMENT', 'Commit payload documentId is outside this store.', {
        commitId,
        documentId: payload.documentId,
        expectedDocumentId,
      }),
    );
  }

  const expectedDependencies = dependenciesForPayload(payload);
  const expectedKeys = new Set(expectedDependencies.map(dependencyKey));
  const actualKeys = new Set(record.preimage.dependencies.map(dependencyKey));
  for (const dependency of expectedDependencies) {
    if (!actualKeys.has(dependencyKey(dependency))) {
      diagnostics.push(
        diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload reference is not a dependency.', {
          commitId,
          dependency,
        }),
      );
    }
  }
  for (const dependency of record.preimage.dependencies) {
    if (!expectedKeys.has(dependencyKey(dependency))) {
      diagnostics.push(
        diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit object has an unexpected dependency.', {
          commitId,
          dependency,
        }),
      );
    }
  }

  return diagnostics;
}

export async function validateCommitDependenciesPresent(
  objectStore: InMemoryVersionObjectStore,
  commitId: WorkbookCommitId,
  dependencies: readonly VersionDependencyRef[],
): Promise<readonly WorkbookCommitStoreDiagnostic[]> {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  for (const dependency of dependencies) {
    try {
      await objectStore.getObjectRecord(dependency);
    } catch (error) {
      const source = error instanceof VersionObjectStoreError ? error.diagnostic : undefined;
      const missing =
        source?.code === 'VERSION_OBJECT_NOT_FOUND' ||
        source?.code === 'VERSION_OBJECT_TYPE_MISMATCH';
      const code = missing
        ? dependency.kind === 'commit'
          ? 'VERSION_MISSING_PARENT'
          : 'VERSION_MISSING_DEPENDENCY'
        : 'VERSION_OBJECT_STORE_FAILURE';
      diagnostics.push(
        diagnostic(
          code,
          missing
            ? 'Commit dependency object is missing or has the wrong object type.'
            : 'Commit dependency object failed integrity validation.',
          {
            commitId,
            objectDigest: dependency.digest,
            dependency,
            ...(source === undefined ? {} : { sourceDiagnostics: [source] }),
          },
        ),
      );
    }
  }
  return diagnostics;
}

export function commitFromRecord(
  commitId: WorkbookCommitId,
  record: VersionObjectRecord<WorkbookCommitPayload>,
): WorkbookCommit {
  return {
    id: commitId,
    record,
    payload: record.preimage.payload,
  };
}
