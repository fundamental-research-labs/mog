import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../../../document/version-store/diff-service';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import { WorkbookVersionImpl } from '../version';
import {
  defaultCellChange,
  validSemanticPayload,
} from './version-diff-projection-fixtures';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'version-diff-projection',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function createVersion(provider: VersionStoreProvider): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: createWorkbookVersionDiffService({ provider }),
    },
  } as any);
}

export async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const appended = await appendChild(
    {
      provider,
      namespace,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

export async function graphWithMergeTarget() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-merge', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-merge');
  const graph = await provider.openGraph(namespace);
  const branch = await graph.createBranch({
    name: 'scenario/merge-parent',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const ours = await graph.commit(
    await commitInput(
      namespace,
      'ours',
      validSemanticPayload('ours', [defaultCellChange('ours')]),
      initialized.rootCommit.id,
      initialized.initialHead.revision,
    ),
  );
  if (ours.status !== 'success')
    throw new Error(`expected ours commit: ${ours.diagnostics[0]?.code}`);

  const theirs = await graph.commit(
    await commitInput(
      namespace,
      'theirs',
      validSemanticPayload('theirs', [defaultCellChange('theirs')]),
      initialized.rootCommit.id,
      branch.branch.ref.refVersion,
      {
        targetRef: 'refs/heads/scenario/merge-parent',
        parentCommitIds: [initialized.rootCommit.id],
      },
    ),
  );
  if (theirs.status !== 'success') {
    throw new Error(`expected theirs commit: ${theirs.diagnostics[0]?.code}`);
  }

  const merge = await graph.mergeCommit({
    ...(await graphContentInput(
      namespace,
      'merge',
      validSemanticPayload('merge', [defaultCellChange('merge')]),
    )),
    expectedHeadCommitId: ours.commit.id,
    expectedMainRefVersion: ours.main.revision,
    mergeParentCommitId: theirs.commit.id,
  });
  if (merge.status !== 'success') {
    throw new Error(`expected merge commit: ${merge.diagnostics[0]?.code}`);
  }

  return {
    provider,
    oursCommitId: ours.commit.id,
    theirsCommitId: theirs.commit.id,
    mergeCommitId: merge.commit.id,
  };
}

export function providerWithPermutedSemanticReads(
  provider: VersionStoreProvider,
  permutations: readonly (readonly number[])[],
): VersionStoreProvider {
  let readCount = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: () => provider.readGraphRegistry(),
    initializeGraph: (input) => provider.initializeGraph(input),
    scanDocumentIntegrity: (options) => provider.scanDocumentIntegrity(options),
    close: (reason) => provider.close(reason),
    dispose: (reason) => provider.dispose(reason),
    openGraph: async (namespace, accessContext) => {
      const graph = await provider.openGraph(namespace, accessContext);
      return new Proxy(graph, {
        get(target, property, receiver) {
          if (property === 'getObjectRecord') {
            return async <TPayload>(ref: Parameters<typeof graph.getObjectRecord<TPayload>>[0]) => {
              const record = await graph.getObjectRecord<TPayload>(ref);
              if (record.preimage.objectType !== 'workbook.semanticChangeSet.v1') return record;
              const payload = record.preimage.payload;
              if (!isRecord(payload)) return record;
              const permutation = permutations[readCount++ % permutations.length] ?? [];
              return {
                ...record,
                preimage: {
                  ...record.preimage,
                  payload: {
                    ...payload,
                    ...(Array.isArray(payload.changes)
                      ? { changes: permute(payload.changes, permutation) }
                      : {}),
                    ...(Array.isArray(payload.reviewChanges)
                      ? { reviewChanges: permute(payload.reviewChanges, permutation) }
                      : {}),
                  } as TPayload,
                },
              };
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

async function appendChild(
  graph: {
    readonly provider: VersionStoreProvider;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly semanticPayload: unknown;
  },
): Promise<{ readonly childCommitId: WorkbookCommitId }> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');

  const committed = await opened.commit(
    await commitInput(
      graph.namespace,
      options.label,
      options.semanticPayload,
      head.head.id,
      head.head.refRevision as RefVersion,
    ),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return { childCommitId: committed.commit.id };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      ...(await graphContentInput(namespace, label, validSemanticPayload(label, []))),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedRefVersion: RefVersion,
  options: {
    readonly targetRef?: string;
    readonly parentCommitIds?: readonly WorkbookCommitId[];
  } = {},
) {
  return {
    ...(await graphContentInput(namespace, label, semanticPayload)),
    ...(options.targetRef
      ? { targetRef: options.targetRef, expectedTargetRefVersion: expectedRefVersion }
      : { expectedMainRefVersion: expectedRefVersion }),
    ...(options.parentCommitIds ? { parentCommitIds: options.parentCommitIds } : {}),
    expectedHeadCommitId,
  };
}

async function graphContentInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
) {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      namespace,
      'workbook.semanticChangeSet.v1',
      semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
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

function permute<T>(values: readonly T[], permutation: readonly number[]): readonly T[] {
  if (permutation.length !== values.length) return values;
  return permutation.map((index) => values[index]).filter((value) => value !== undefined);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
