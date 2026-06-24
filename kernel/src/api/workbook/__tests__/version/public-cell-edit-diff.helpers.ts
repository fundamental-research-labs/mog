import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../../document/version-store/provider';

export const DOCUMENT_ID = 'vc04-public-cell-edit-diff';
export const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type StoredSemanticChangeSetPayload = {
  readonly source: {
    readonly beforeStateDigest: SemanticDigest;
    readonly afterStateDigest: SemanticDigest;
  };
  readonly semanticDiff: {
    readonly beforeDigest: SemanticDigest;
    readonly afterDigest: SemanticDigest;
    readonly changes: readonly unknown[];
  };
  readonly changes: readonly unknown[];
  readonly reviewChanges: readonly unknown[];
  readonly [key: string]: unknown;
};

type SemanticDigest = {
  readonly algorithm: string;
  readonly byteLength: number;
  readonly value: string;
};

export function expectedSemanticDigest() {
  return expect.objectContaining({
    algorithm: 'sha256',
    byteLength: expect.any(Number),
    value: expect.any(String),
  });
}

export function expectedCellDiff(address: string, value: unknown) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'cell',
      entityId: expect.stringMatching(new RegExp(`!${address}$`)),
      propertyPath: ['value'],
    }),
    after: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  });
}

export function expectedRowOrderDiff(address: string) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'rows-columns',
      propertyPath: ['order'],
    }),
    after: {
      kind: 'value',
      value: expect.objectContaining({
        fields: expect.arrayContaining([
          { key: 'axis', value: 'row' },
          { key: 'displayRef', value: address },
        ]),
      }),
    },
    display: { address: { kind: 'value', value: address } },
  });
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function readSemanticChangeSetPayload(
  provider: VersionStoreProvider,
  commitId: string,
): Promise<StoredSemanticChangeSetPayload> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
  const read = await graph.readCommit(commitId);
  expect(read.status).toBe('success');
  if (read.status !== 'success') {
    throw new Error('expected committed record to be readable');
  }
  const semanticChangeSetRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: read.commit.payload.semanticChangeSetDigest,
  });
  expect(typeof semanticChangeSetRecord.preimage.payload).toBe('object');
  expect(semanticChangeSetRecord.preimage.payload).not.toBeNull();
  return semanticChangeSetRecord.preimage.payload as StoredSemanticChangeSetPayload;
}

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
