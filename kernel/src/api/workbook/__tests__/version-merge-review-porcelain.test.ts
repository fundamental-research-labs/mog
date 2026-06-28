import { describe, expect, it, jest } from '@jest/globals';

import type {
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../../../document/version-store/commit-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createMergePreviewArtifactRecord,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
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
} from '../../../document/version-store/provider';
import { createVersionGraphRegistry } from '../../../document/version-store/registry';
import { WorkbookVersionImpl } from '../version';
import { formulaConflict } from './version-merge-review-endpoints-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as WorkbookCommitId;
const OURS = `commit:sha256:${'2'.repeat(64)}` as WorkbookCommitId;
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as WorkbookCommitId;
const MERGE_COMMIT = `commit:sha256:${'4'.repeat(64)}` as WorkbookCommitId;
const STALE_MAIN = `commit:sha256:${'5'.repeat(64)}` as WorkbookCommitId;
const MAIN_REF = 'refs/heads/main';
const BRANCH_NAME = 'scenario/merge-review-porcelain';
const BRANCH_REF = `refs/heads/${BRANCH_NAME}`;
const MAIN_REVISION = { kind: 'counter', value: '7' } as const;
const BRANCH_REVISION = { kind: 'counter', value: '8' } as const;
const STALE_MAIN_REVISION = { kind: 'counter', value: '9' } as const;
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
const CREATED_AT = '2026-06-28T00:00:00.000Z';

describe('WorkbookVersion merge review porcelain', () => {
  it('previews and applies a clean branch merge with the previewed target fence', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'clean',
      includeFastForwardService: false,
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected preview: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'clean',
        baseCommitId: BASE,
        targetRef: MAIN_REF,
        targetHead: { commitId: OURS, revision: MAIN_REVISION },
        mergeInput: { base: BASE, ours: OURS, theirs: THEIRS },
      },
    });
    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected apply: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: { id: MERGE_COMMIT, refName: MAIN_REF },
        resolutionCount: 0,
      },
    });
    expect(fixture.merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      expect.objectContaining({
        mode: 'preview',
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: OURS, revision: MAIN_REVISION },
      }),
    );
    expect(fixture.mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: OURS, revision: MAIN_REVISION },
        resolutionCount: 0,
      }),
    );
  });

  it('previews and applies a fast-forward branch merge', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'fastForward',
      parents: { [OURS]: [BASE], [THEIRS]: [OURS] },
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected preview: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'fastForward',
        baseCommitId: OURS,
        mergeInput: { base: OURS, ours: OURS, theirs: THEIRS },
      },
    });
    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected apply: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'fastForwarded',
        base: OURS,
        ours: OURS,
        theirs: THEIRS,
        commitRef: { id: THEIRS, refName: MAIN_REF },
        resolutionCount: 0,
      },
    });
    expect(fixture.fastForwardMerge).toHaveBeenCalledWith(
      expect.objectContaining({ base: OURS, ours: OURS, theirs: THEIRS, targetRef: MAIN_REF }),
    );
    expect(fixture.mergeCommit).not.toHaveBeenCalled();
  });

  it('previews and applies an already-merged branch without writing a merge commit', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'alreadyMerged',
      parents: { [THEIRS]: [BASE], [OURS]: [THEIRS] },
      includeFastForwardService: false,
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected preview: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'alreadyMerged',
        baseCommitId: THEIRS,
        mergeInput: { base: THEIRS, ours: OURS, theirs: THEIRS },
      },
    });
    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected apply: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: THEIRS,
        ours: OURS,
        theirs: THEIRS,
        commitRef: { id: OURS, refName: MAIN_REF },
      },
    });
    expect(fixture.mergeCommit).not.toHaveBeenCalled();
  });

  it('chooses conflicted preview resolutions and applies through the merge write service', async () => {
    const conflict = formulaConflict({ result: 2, conflictIdDigit: '5' });
    const fixture = await createMergeReviewWorkbook({ status: 'conflicted', conflicts: [conflict] });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected preview: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'conflicted',
        conflicts: [expect.objectContaining({ conflictId: conflict.conflictId })],
        selectedResolutions: [],
      },
    });
    review.value.chooseAll('acceptTheirs');
    expect(review.value.selectedResolutions).toEqual([
      expect.objectContaining({
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflict.conflictDigest,
        kind: 'acceptTheirs',
      }),
    ]);

    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected apply: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        resolutionCount: 1,
      },
    });
    expect(fixture.mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionCount: 1,
        changes: [expect.objectContaining({ structural: conflict.structural })],
      }),
    );
  });

  it('returns staleTargetHead when the target ref moves between preview and apply', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'clean',
      includeFastForwardService: false,
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected preview: ${JSON.stringify(review.error)}`);
    fixture.setMainRef(STALE_MAIN, STALE_MAIN_REVISION);

    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected stale result: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'staleTargetHead',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
      },
    });
    expect(fixture.mergeCommit).not.toHaveBeenCalled();
  });

  it('reloads a persisted review artifact and applies through the persisted artifact path', async () => {
    const fixture = await createPersistedMergeReviewWorkbook();

    const review = await fixture.wb.version.getMergeReview({
      resultId: fixture.resultId,
      resultDigest: fixture.resultDigest,
      targetRef: MAIN_REF,
      targetHead: fixture.targetHead,
    });
    if (!review.ok) throw new Error(`expected persisted review: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'clean',
        resultId: fixture.resultId,
        resultDigest: fixture.resultDigest,
        targetRef: MAIN_REF,
        targetHead: fixture.targetHead,
      },
    });
    expect(review.value.toApplyInput()).toMatchObject({
      resultId: fixture.resultId,
      resultDigest: fixture.resultDigest,
      previewArtifactDigest: fixture.resultDigest,
    });

    const applied = await review.value.apply();
    if (!applied.ok) throw new Error(`expected persisted apply: ${JSON.stringify(applied.error)}`);
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        base: fixture.base,
        ours: fixture.ours,
        theirs: fixture.theirs,
        resultId: fixture.resultId,
        resultDigest: fixture.resultDigest,
        commitRef: { refName: MAIN_REF, resolvedFrom: MAIN_REF },
      },
    });
    expect(fixture.mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        base: fixture.base,
        ours: fixture.ours,
        theirs: fixture.theirs,
        targetRef: MAIN_REF,
        expectedTargetHead: fixture.targetHead,
        resolvedMergeAttemptDigest: expect.objectContaining({ algorithm: 'sha256' }),
      }),
    );
  });

  it('returns a blocked review when merge capability is disabled', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'clean',
      contextOverrides: { featureGates: { versionControlMerge: false } },
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected blocked review: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'blocked',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
          }),
        ],
      },
    });
    expect(fixture.merge).not.toHaveBeenCalled();
  });

  it('returns a blocked review when the merge kill switch is active', async () => {
    const fixture = await createMergeReviewWorkbook({
      status: 'clean',
      versioningOverrides: { versionControlMergeKillSwitch: true },
    });

    const review = await fixture.wb.version.previewMerge({ from: BRANCH_NAME, into: 'main' });
    if (!review.ok) throw new Error(`expected blocked review: ${JSON.stringify(review.error)}`);
    expect(review).toMatchObject({
      ok: true,
      value: {
        status: 'blocked',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
            severity: 'error',
          }),
        ],
      },
    });
    expect(fixture.merge).not.toHaveBeenCalled();
  });
});

async function createMergeReviewWorkbook(input: {
  readonly status: Exclude<VersionMergeResult['status'], 'blocked'>;
  readonly conflicts?: readonly VersionMergeConflict[];
  readonly parents?: Readonly<Record<string, readonly WorkbookCommitId[]>>;
  readonly includeFastForwardService?: boolean;
  readonly versioningOverrides?: Readonly<Record<string, unknown>>;
  readonly contextOverrides?: Readonly<Record<string, unknown>>;
}) {
  const parents = input.parents ?? { [OURS]: [BASE], [THEIRS]: [BASE] };
  let mainCommitId = OURS;
  let mainRevision: typeof MAIN_REVISION | typeof STALE_MAIN_REVISION = MAIN_REVISION;
  const registry = await createVersionGraphRegistry({
    documentScope: { documentId: `merge-review-porcelain-${input.status}` },
    graphId: `merge-review-porcelain-${input.status}`,
    rootCommitId: BASE,
    createdAt: '2026-06-28T00:00:00.000Z',
  });
  const graph = {
    readCommitClosure: jest.fn(async (commitId: WorkbookCommitId) => ({
      status: 'success',
      commits: commitClosure(commitId, parents),
    })),
    readRef: jest.fn(async (name: string) => {
      if (name === 'HEAD') {
        return { status: 'success', ref: { name: 'HEAD', target: MAIN_REF, revision: MAIN_REVISION }, diagnostics: [] };
      }
      return {
        status: 'success',
        ref: {
          name,
          commitId: name === MAIN_REF ? mainCommitId : THEIRS,
          revision: name === MAIN_REF ? mainRevision : BRANCH_REVISION,
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
        diagnostics: [],
      };
    }),
  };
  const provider = {
    documentScope: { documentId: `merge-review-porcelain-${input.status}` },
    accessContext: {},
    capabilities: {
      durableGraphRegistry: false,
      durableObjects: false,
      atomicObjectBatch: false,
      casRefs: true,
      casGraphRegistry: true,
      multiProcessCasGraphRegistry: false,
      multiProcessCasRefs: false,
      readOnlyHistory: false,
      integrityScan: false,
      corruptionQuarantine: false,
      reads: {
        graphRegistry: true,
        objects: true,
        refs: true,
        commits: true,
        snapshots: false,
        integrityReports: false,
      },
      writes: {
        initializeGraph: false,
        putObjects: false,
        updateRefs: true,
        updateSymbolicRefs: false,
        commitGraphWrite: true,
        repairIndexes: false,
        quarantineCorruptRecords: false,
      },
    },
    readGraphRegistry: jest.fn(async () => ({ status: 'ok', registry })),
    openGraph: jest.fn(async () => graph),
    initializeGraph: jest.fn(),
    scanDocumentIntegrity: jest.fn(),
    close: jest.fn(),
    dispose: jest.fn(),
  };
  const branchService = {
    readBranch: jest.fn(async (request: Readonly<Record<string, unknown>> | string) => {
      const name =
        typeof request === 'string'
          ? request
          : typeof request?.name === 'string'
            ? request.name
            : typeof request?.branchName === 'string'
              ? request.branchName
              : 'main';
      const refName = name === 'main' || name === MAIN_REF ? MAIN_REF : BRANCH_REF;
      const revision = refName === MAIN_REF ? MAIN_REVISION : BRANCH_REVISION;
      return {
        ok: true,
        branch: {
          name: refName === MAIN_REF ? 'main' : BRANCH_NAME,
          ref: {
            targetCommitId: refName === MAIN_REF ? OURS : THEIRS,
            refVersion: revision,
          },
        },
      };
    }),
  };
  const merge = jest.fn(async (request: VersionMergeInput) => mergeResult(input, request));
  const mergeCommit = jest.fn(async () => ({
    status: 'applied',
    commitRef: { id: MERGE_COMMIT, refName: MAIN_REF, resolvedFrom: MAIN_REF },
  }));
  const fastForwardMerge = jest.fn(async () => ({
    status: 'fastForwarded',
    commitRef: { id: THEIRS, refName: MAIN_REF, resolvedFrom: MAIN_REF },
  }));

  const wb = {
    version: new WorkbookVersionImpl({
      ...(input.contextOverrides ?? {}),
      versioning: {
        provider,
        branchService,
        mergeService: { merge },
        writeService: {
          mergeCommit,
          ...(input.includeFastForwardService === false ? {} : { fastForwardMerge }),
        },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
        ...(input.versioningOverrides ?? {}),
      },
    } as any),
  };

  return {
    wb,
    merge,
    mergeCommit,
    fastForwardMerge,
    branchService,
    setMainRef(commitId: WorkbookCommitId, revision: typeof MAIN_REVISION | typeof STALE_MAIN_REVISION) {
      mainCommitId = commitId;
      mainRevision = revision;
    },
  };
}

async function createPersistedMergeReviewWorkbook() {
  const graphId = 'merge-review-porcelain-persisted';
  const documentScope: VersionDocumentScope = {
    documentId: `merge-review-porcelain-persisted-${Date.now()}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(documentScope, graphId));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const graph = await provider.openGraph(namespace);
  const base = initialized.rootCommit.id;
  const head = await graph.readHead();
  if (head.status !== 'success') throw new Error('expected readable root head');
  const ours = await graph.commit({
    ...(await graphWrite(namespace, 'ours')),
    expectedHeadCommitId: base,
    expectedMainRefVersion: head.main.revision,
    parentCommitIds: [base],
  });
  if (ours.status !== 'success') {
    throw new Error(`expected ours commit success: ${ours.diagnostics[0]?.code}`);
  }
  const theirs = await createDetachedChild(provider, namespace, {
    label: 'theirs',
    parentCommitId: base,
  });
  const targetHead: VersionCommitExpectedHead = {
    commitId: ours.commit.id,
    revision: ours.main.revision,
  };
  const previewRecord = await createMergePreviewArtifactRecord(namespace, {
    status: 'clean',
    base,
    ours: ours.commit.id,
    theirs,
    changes: [],
  });
  const putPreview = await graph.putObjects([previewRecord]);
  expect(putPreview).toMatchObject({ status: 'success' });

  const mergeCommit = jest.fn(async (request: Readonly<Record<string, unknown>>) => {
    const writeGraph = await provider.openGraph(namespace);
    const merged = await writeGraph.mergeCommit({
      ...(await graphWrite(namespace, 'merge-commit')),
      targetRef: MAIN_REF,
      expectedHeadCommitId: String(request.ours),
      expectedMainRefVersion: targetHead.revision,
      mergeParentCommitId: String(request.theirs),
      resolvedMergeAttemptDigest: request.resolvedMergeAttemptDigest as never,
    });
    if (merged.status !== 'success') return merged;
    return {
      status: 'applied',
      resultId: request.resultId,
      previewArtifactDigest: request.previewArtifactDigest,
      resultDigest: request.resultDigest,
      targetRef: MAIN_REF,
      headBefore: request.ours,
      headAfter: merged.commit.id,
      commitRef: {
        id: merged.commit.id,
        refName: MAIN_REF,
        resolvedFrom: MAIN_REF,
      },
      changes: [],
      conflicts: [],
      diagnostics: [],
      resolutionCount: request.resolutionCount,
      mutationGuarantee: 'ref-mutated',
    };
  });
  const wb = {
    version: new WorkbookVersionImpl({
      versioning: {
        provider,
        writeService: { mergeCommit },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any),
  };

  return {
    wb,
    mergeCommit,
    base,
    ours: ours.commit.id,
    theirs,
    targetHead,
    resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
    resultDigest: previewRecord.digest,
  };
}

function mergeResult(
  input: {
    readonly status: Exclude<VersionMergeResult['status'], 'blocked'>;
    readonly conflicts?: readonly VersionMergeConflict[];
  },
  request: VersionMergeInput,
): VersionMergeResult {
  const conflicts = input.status === 'conflicted' ? (input.conflicts ?? []) : [];
  return {
    status: input.status,
    base: request.base as WorkbookCommitId,
    ours: request.ours as WorkbookCommitId,
    theirs: request.theirs as WorkbookCommitId,
    changes: [],
    conflicts,
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  } as VersionMergeResult;
}

function commitClosure(
  commitId: WorkbookCommitId,
  parents: Readonly<Record<string, readonly WorkbookCommitId[]>>,
) {
  const seen = new Set<WorkbookCommitId>();
  const commits: { readonly id: WorkbookCommitId; readonly payload: { readonly parentCommitIds: readonly WorkbookCommitId[] } }[] = [];
  const visit = (id: WorkbookCommitId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const parentCommitIds = parents[id] ?? [];
    commits.push({ id, payload: { parentCommitIds } });
    for (const parent of parentCommitIds) visit(parent);
  };
  visit(commitId);
  return commits;
}

async function initializeInput(
  documentScope: VersionDocumentScope,
  graphId: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await graphWrite(namespace, 'root'),
  };
}

async function graphWrite(namespace: VersionGraphNamespace, label: string) {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
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

async function createDetachedChild(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  namespace: VersionGraphNamespace,
  input: {
    readonly label: string;
    readonly parentCommitId: WorkbookCommitId;
  },
): Promise<WorkbookCommitId> {
  const graph = await provider.openGraph(namespace);
  const commitStore = createInMemoryWorkbookCommitStore(graph.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: namespace.documentId,
    parentCommitIds: [input.parentCommitId],
    ...(await graphWrite(namespace, input.label)),
  });
  if (created.status !== 'success') {
    throw new Error(`expected detached child commit success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
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
