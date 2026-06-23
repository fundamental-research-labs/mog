import { jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../../../document/version-store/commit-store';
import { createWorkbookVersionMergeService } from '../../../document/version-store/merge-service';
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
  type VersionGraphStore,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import { mapApplyMergeWriteResult } from '../version-apply-merge-write-result';
import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-vc07',
  documentId: 'document-vc07-merge-base',
  principalScope: 'principal-vc07',
};
const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-vc07',
  actorKind: 'user',
  displayName: 'VC07 User',
};

describe('WorkbookVersion VC-07 merge-base gate', () => {
  it('blocks public no-base histories before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-no-merge-base');
    const unrelatedRoot = await createCommit(graph, {
      label: 'unrelated-root',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-unrelated-root',
      parentCommitIds: [unrelatedRoot],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: graph.rootCommitId, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_UNRELATED_HISTORIES', {
      diagnosticCode: 'unrelatedHistories',
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks public multiple-base histories before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-ambiguous-merge-base');
    const baseA = await createCommit(graph, {
      label: 'base-a',
      parentCommitIds: [graph.rootCommitId],
    });
    const baseB = await createCommit(graph, {
      label: 'base-b',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-criss-cross',
      parentCommitIds: [baseA, baseB],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-criss-cross',
      parentCommitIds: [baseB, baseA],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: baseA, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_BASE_AMBIGUOUS', {
      diagnosticCode: 'mergeBaseAmbiguous',
      lowestCommonAncestorCount: 2,
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks public missing base objects before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-base-object');
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: commitId('f'), ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MISSING_OBJECT');
    expect(merge).not.toHaveBeenCalled();
  });

  it('reports every missing public merge ref before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-all-refs');
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({
      base: commitId('d'),
      ours: commitId('e'),
      theirs: commitId('f'),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
      },
    });
    if (result.ok) throw new Error('expected public merge failure');
    expect(
      result.error.diagnostics
        .filter((diagnostic) => diagnostic.code === 'VERSION_MISSING_OBJECT')
        .map((diagnostic) => diagnostic.data.payload?.mergeRef)
        .sort(),
    ).toEqual(['base', 'ours', 'theirs']);
    expect(JSON.stringify(result.error.diagnostics)).not.toContain('commit:sha256:');
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks public ancestry shortcuts without a base proof before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-base-proof');
    const staleBase = await createCommit(graph, {
      label: 'stale-base',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: staleBase, ours, theirs: ours });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_BASE_MISMATCH', {
      diagnosticCode: 'missingBaseProof',
      baseInOurs: false,
      baseInTheirs: false,
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks divergent non-direct ancestry before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-divergent-non-direct-ancestry');
    const base = await createCommit(graph, {
      label: 'base',
      parentCommitIds: [graph.rootCommitId],
    });
    const intermediate = await createCommit(graph, {
      label: 'ours-intermediate',
      parentCommitIds: [base],
    });
    const ours = await createCommit(graph, {
      label: 'ours-grandchild',
      parentCommitIds: [intermediate],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-direct-child',
      parentCommitIds: [base],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_UNSUPPORTED_ANCESTRY', {
      mergeRef: 'ours',
      parentCount: 1,
      parentMatchesBase: false,
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it.each(['base', 'ours', 'theirs'] as const)(
    'blocks public %s closure ref mismatches with redacted diagnostics',
    async (mergeRef) => {
      const graph = await graphWithRoot('graph-public-ref-mismatch');
      const unrelatedRoot = await createCommit(graph, {
        label: 'unrelated-root',
        parentCommitIds: [],
      });
      const ours = await createCommit(graph, {
        label: 'ours-related-to-main-root',
        parentCommitIds: [graph.rootCommitId],
      });
      const theirs = await createCommit(graph, {
        label: 'theirs-related-to-main-root',
        parentCommitIds: [graph.rootCommitId],
      });
      const merge = mergeServiceMustNotRun();
      const input = { base: graph.rootCommitId, ours, theirs };
      const provider = providerWithClosureSubstitution(
        graph.provider,
        input[mergeRef],
        mergeRef === 'base' ? unrelatedRoot : graph.rootCommitId,
      );
      const version = publicWorkbookVersion(provider, merge);

      const result = await version.merge(input);

      const diagnostic = expectPublicSafeMergeFailure(result, 'VERSION_UNMATERIALIZABLE_COMMIT', {
        diagnosticCode: 'commitClosureRefMismatch',
        mergeRef,
      });
      expect(diagnostic.data).toMatchObject({
        operation: 'merge',
        redacted: true,
        payload: {
          operation: 'merge',
          diagnosticCode: 'commitClosureRefMismatch',
          mergeRef,
        },
      });
      expect(JSON.stringify(diagnostic.data.payload)).not.toContain('commit:sha256:');
      expect(merge).not.toHaveBeenCalled();
    },
  );

  it('allows public already-merged ancestor previews to reach the merge service', async () => {
    const graph = await graphWithRoot('graph-public-already-merged-ancestor');
    const theirs = await createCommit(graph, {
      label: 'theirs-ancestor',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-descendant',
      parentCommitIds: [theirs],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });
    const merge = jest.fn(
      (input: VersionMergeInput, options?: Parameters<typeof service.merge>[1]) =>
        service.merge(input, options),
    );
    const version = publicWorkbookVersion(graph.provider, merge);

    await expect(version.merge({ base: graph.rootCommitId, ours, theirs })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: graph.rootCommitId,
        ours,
        theirs,
        changes: [],
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('blocks criss-cross histories with ambiguous lowest common merge bases', async () => {
    const graph = await graphWithRoot('graph-ambiguous-merge-base');
    const baseA = await createCommit(graph, {
      label: 'base-a',
      parentCommitIds: [graph.rootCommitId],
    });
    const baseB = await createCommit(graph, {
      label: 'base-b',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-criss-cross',
      parentCommitIds: [baseA, baseB],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-criss-cross',
      parentCommitIds: [baseB, baseA],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: baseA, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: baseA,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_BASE_AMBIGUOUS',
          payload: expect.objectContaining({
            diagnosticCode: 'mergeBaseAmbiguous',
            lowestCommonAncestorCount: 2,
          }),
          redacted: true,
        }),
      ],
    });
  });

  it('blocks unrelated histories that have no common merge base', async () => {
    const graph = await graphWithRoot('graph-unrelated-histories');
    const unrelatedRoot = await createCommit(graph, {
      label: 'unrelated-root',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-unrelated-root',
      parentCommitIds: [unrelatedRoot],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: graph.rootCommitId, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: graph.rootCommitId,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNRELATED_HISTORIES',
          payload: expect.objectContaining({ diagnosticCode: 'unrelatedHistories' }),
          redacted: true,
        }),
      ],
    });
  });

  it('returns stale-target-head apply diagnostics without accepting merge application', () => {
    const plan = {
      base: commitId('1'),
      ours: commitId('2'),
      theirs: commitId('3'),
      changes: [],
      resolutionCount: 0,
    };

    const result = mapApplyMergeWriteResult(
      {
        status: 'staleTargetHead',
        base: plan.base,
        ours: plan.ours,
        theirs: plan.theirs,
        diagnostics: [],
      },
      plan,
      'merge-commit-created',
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
          }),
          mutationGuarantee: 'ref-not-mutated',
          redacted: true,
        }),
      ],
    });
  });
});

async function graphWithRoot(graphId: string) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    provider,
    namespace,
    rootCommitId: initialized.rootCommit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function publicWorkbookVersion(provider: VersionStoreProvider, merge: unknown) {
  return new WorkbookVersionImpl({
    versioning: {
      provider,
      mergeService: { merge },
      ...versionDomainSupportManifestRuntime(),
    },
  } as any);
}

function mergeServiceMustNotRun() {
  return jest.fn(async () => {
    throw new Error('merge service should not be invoked after merge-base resolution fails');
  });
}

function providerWithClosureSubstitution(
  provider: VersionStoreProvider,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionStoreProvider {
  const readGraphRegistry: VersionStoreProvider['readGraphRegistry'] = () =>
    provider.readGraphRegistry();
  const openGraph: VersionStoreProvider['openGraph'] = async (namespace, accessContext) =>
    graphWithClosureSubstitution(
      await provider.openGraph(namespace, accessContext),
      requestedCommitId,
      returnedCommitId,
    );

  return {
    readGraphRegistry,
    openGraph,
  } as VersionStoreProvider;
}

function graphWithClosureSubstitution(
  graph: VersionGraphStore,
  requestedCommitId: WorkbookCommitId,
  returnedCommitId: WorkbookCommitId,
): VersionGraphStore {
  return new Proxy(graph, {
    get(target, property, receiver) {
      if (property !== 'readCommitClosure') return Reflect.get(target, property, receiver);
      return (commitId: WorkbookCommitId | string) =>
        target.readCommitClosure(commitId === requestedCommitId ? returnedCommitId : commitId);
    },
  });
}

function expectPublicSafeMergeFailure(
  result: Awaited<ReturnType<WorkbookVersionImpl['merge']>>,
  code: string,
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
) {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.merge',
      diagnostics: [
        expect.objectContaining({
          code,
          owner: 'version-store',
          data: expect.objectContaining({
            operation: 'merge',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'merge',
              ...payload,
            }),
          }),
        }),
      ],
    },
  });
  if (result.ok) {
    throw new Error('expected public merge failure');
  }

  const diagnostic = result.error.diagnostics.find((item) => item.code === code);
  expect(diagnostic).toBeDefined();
  expect(JSON.stringify(diagnostic)).not.toContain('commit:sha256:');
  return diagnostic!;
}

async function createCommit(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitIds: readonly WorkbookCommitId[];
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: options.parentCommitIds,
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(graph.namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(graph.namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${options.label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  });
  if (created.status !== 'success') {
    throw new Error(`expected commit create success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
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
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
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

function commitId(hexDigit: string): VersionMergeInput['base'] {
  return `commit:sha256:${hexDigit.repeat(64)}` as VersionMergeInput['base'];
}
