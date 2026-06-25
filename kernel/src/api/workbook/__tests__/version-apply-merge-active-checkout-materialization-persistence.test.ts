import { describe, expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { createWorkbookVersionSurfaceStatusService } from '../version/surface-status/version-surface-status-service';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  EXPECTED_TARGET_HEAD,
  MERGE,
  metadata,
  OURS,
  THEIRS,
} from './version-apply-merge-test-utils';

const BRANCH_NAME = 'scenario/apply-merge-materialization-persistence';
const BRANCH_REF = `refs/heads/${BRANCH_NAME}` as const;
const ACTIVE_REVISION = EXPECTED_TARGET_HEAD.revision;
const MERGE_REVISION = { kind: 'counter' as const, value: '2' };

describe('WorkbookVersion applyMerge active checkout materialization persistence', () => {
  it('writes the persisted active-checkout marker only after physical materialization succeeds', async () => {
    const order: string[] = [];
    const durable = createDurableMarkerStore(order);
    const { version } = createMaterializedApplyMergeVersion({
      order,
      provider: durable.provider,
      checkoutCommitId: MERGE,
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: BRANCH_REF,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        commitRef: {
          id: MERGE,
          refName: BRANCH_REF,
        },
      },
    });

    expect(order).toEqual(['mergeCommit', 'checkout', 'clear', 'write']);
    expect(durable.readRecord()).toMatchObject({
      checkedOutCommitId: MERGE,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: MERGE,
    });
  });

  it('clears a previous persisted marker when ref apply succeeds but physical materialization is stale', async () => {
    const order: string[] = [];
    const durable = createDurableMarkerStore(order, {
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
    const { surfaceStatusService, version } = createMaterializedApplyMergeVersion({
      order,
      provider: durable.provider,
      checkoutCommitId: OURS,
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: BRANCH_REF,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          }),
        ]),
      },
    });

    expect(order).toEqual(['mergeCommit', 'checkout', 'clear']);
    expect(durable.store.write).not.toHaveBeenCalled();
    expect(durable.readRecord()).toBeNull();
    expect(surfaceStatusService.readActiveCheckoutSession()).toMatchObject({
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: MERGE,
      detached: false,
    });
    await expect(version.getSurfaceStatus()).resolves.toMatchObject({
      current: {
        checkedOutCommitId: OURS,
        branchName: BRANCH_NAME,
        currentRefHeadId: MERGE,
        stale: true,
      },
    });
  });

  it('clears a previous persisted marker when apply fails after an unknown ref write', async () => {
    const order: string[] = [];
    const durable = createDurableMarkerStore(order, {
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
    let currentBranchHead = OURS;
    let currentBranchRevision = ACTIVE_REVISION;
    const surfaceStatusService = createSurfaceStatusService();
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: OURS,
      refName: BRANCH_REF,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: currentBranchHead, revision: currentBranchRevision },
    }));
    const merge = jest.fn(async (): Promise<VersionMergeResult> => cleanMergeResult());
    const mergeCommit = jest.fn(async () => {
      order.push('mergeCommit');
      currentBranchHead = MERGE;
      currentBranchRevision = MERGE_REVISION;
      return {
        status: 'success',
        targetRef: BRANCH_REF,
        headBefore: OURS,
        headAfter: MERGE,
        commitRef: {
          id: MERGE,
          refName: 'refs/heads/scenario/other-branch',
          resolvedFrom: BRANCH_REF,
          refRevision: currentBranchRevision,
        },
        diagnostics: [],
      };
    });
    const checkout = jest.fn();
    const version = new WorkbookVersionImpl(
      {
        versioning: {
          mergeService: { merge },
          readService: { readRef },
          surfaceStatusService,
          writeService: { mergeCommit },
          checkoutService: { checkout },
          provider: durable.provider,
          ...versionDomainSupportManifestRuntime(),
        },
      } as any,
      { checkoutTransactionGuard: createCheckoutTransactionGuard() },
    );

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: BRANCH_REF,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          }),
        ],
      },
    });

    expect(order).toEqual(['mergeCommit', 'clear']);
    expect(checkout).not.toHaveBeenCalled();
    expect(durable.store.write).not.toHaveBeenCalled();
    expect(durable.readRecord()).toBeNull();
  });

  it('leaves a previous persisted marker unchanged when apply returns stale target head', async () => {
    const order: string[] = [];
    const durable = createDurableMarkerStore(order, {
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
    const surfaceStatusService = createSurfaceStatusService();
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: OURS,
      refName: BRANCH_REF,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: OURS, revision: ACTIVE_REVISION },
    }));
    const merge = jest.fn(async (): Promise<VersionMergeResult> => cleanMergeResult());
    const mergeCommit = jest.fn(async () => {
      order.push('mergeCommit');
      return {
        status: 'staleTargetHead',
        diagnostics: [],
      };
    });
    const checkout = jest.fn();
    const version = new WorkbookVersionImpl(
      {
        versioning: {
          mergeService: { merge },
          readService: { readRef },
          surfaceStatusService,
          writeService: { mergeCommit },
          checkoutService: { checkout },
          provider: durable.provider,
          ...versionDomainSupportManifestRuntime(),
        },
      } as any,
      { checkoutTransactionGuard: createCheckoutTransactionGuard() },
    );

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: BRANCH_REF,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'staleTargetHead',
        mutationGuarantee: 'ref-not-mutated',
      },
    });

    expect(order).toEqual(['mergeCommit']);
    expect(checkout).not.toHaveBeenCalled();
    expect(durable.store.clear).not.toHaveBeenCalled();
    expect(durable.store.write).not.toHaveBeenCalled();
    expect(durable.readRecord()).toMatchObject({
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
  });

  it('leaves a previous persisted marker unchanged when stale active checkout blocks before apply', async () => {
    const order: string[] = [];
    const durable = createDurableMarkerStore(order, {
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const checkout = jest.fn();
    const surfaceStatusService = createSurfaceStatusService();
    surfaceStatusService.recordActiveCheckoutBranchCommit({
      commitId: OURS,
      refName: BRANCH_REF,
    });
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: { name, commitId: THEIRS, revision: MERGE_REVISION },
    }));
    const version = new WorkbookVersionImpl(
      {
        versioning: {
          mergeService: { merge },
          readService: { readRef },
          surfaceStatusService,
          writeService: { mergeCommit },
          checkoutService: { checkout },
          provider: durable.provider,
          ...versionDomainSupportManifestRuntime(),
        },
      } as any,
      { checkoutTransactionGuard: createCheckoutTransactionGuard() },
    );

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        {
          targetRef: BRANCH_REF,
          expectedTargetHead: EXPECTED_TARGET_HEAD,
          materializeActiveCheckout: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [expect.objectContaining({ code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD' })],
      },
    });

    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
    expect(durable.store.clear).not.toHaveBeenCalled();
    expect(durable.store.write).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(durable.readRecord()).toMatchObject({
      checkedOutCommitId: OURS,
      branchName: BRANCH_NAME,
      refHeadAtMaterialization: OURS,
    });
  });
});

function createMaterializedApplyMergeVersion(input: {
  readonly order: string[];
  readonly provider: unknown;
  readonly checkoutCommitId: typeof OURS | typeof MERGE;
}) {
  let currentBranchHead = OURS;
  let currentBranchRevision = ACTIVE_REVISION;
  const surfaceStatusService = createSurfaceStatusService();
  surfaceStatusService.recordActiveCheckoutBranchCommit({
    commitId: OURS,
    refName: BRANCH_REF,
  });
  const readRef = jest.fn(async (name: string) => ({
    status: 'success',
    ref: { name, commitId: currentBranchHead, revision: currentBranchRevision },
  }));
  const merge = jest.fn(async (): Promise<VersionMergeResult> => cleanMergeResult());
  const mergeCommit = jest.fn(async () => {
    input.order.push('mergeCommit');
    currentBranchHead = MERGE;
    currentBranchRevision = MERGE_REVISION;
    return {
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: BRANCH_REF,
        resolvedFrom: BRANCH_REF,
        refRevision: currentBranchRevision,
      },
      diagnostics: [],
    };
  });
  const checkout = jest.fn(async () => {
    input.order.push('checkout');
    surfaceStatusService.recordCheckoutMaterialization(
      checkoutMaterialization(input.checkoutCommitId),
    );
    return checkoutResult(input.checkoutCommitId);
  });
  const version = new WorkbookVersionImpl(
    {
      versioning: {
        mergeService: { merge },
        readService: { readRef },
        surfaceStatusService,
        writeService: { mergeCommit },
        checkoutService: { checkout },
        provider: input.provider,
        ...versionDomainSupportManifestRuntime(),
      },
    } as any,
    { checkoutTransactionGuard: createCheckoutTransactionGuard() },
  );
  return { surfaceStatusService, version };
}

function createSurfaceStatusService() {
  return createWorkbookVersionSurfaceStatusService({
    readDirtyState: () => ({
      hasUncommittedLocalChanges: false,
      calculationState: 'done',
      checkoutInProgress: false,
      revision: 0,
      contextGeneration: 0,
    }),
  });
}

function createCheckoutTransactionGuard() {
  return {
    beginCheckoutTransaction: jest.fn(() => ({
      ok: true as const,
      token: {},
    })),
    endCheckoutTransaction: jest.fn(),
  };
}

function createDurableMarkerStore(
  order: string[],
  initialRecord: PersistedMarkerRecord | null = null,
) {
  let record = initialRecord;
  const store = {
    read: jest.fn(async () => record),
    write: jest.fn(async (next: PersistedMarkerRecord) => {
      order.push('write');
      record = next;
    }),
    clear: jest.fn(async () => {
      order.push('clear');
      record = null;
    }),
  };
  return {
    store,
    provider: {
      openActiveCheckoutMaterializationStore: jest.fn(async () => store),
    },
    readRecord: () => record,
  };
}

function cleanMergeResult(): VersionMergeResult {
  return {
    status: 'clean',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [
      {
        structural: metadata('merge-change-materialized-active-branch', 'sheet-1!B2'),
        base: { kind: 'value', value: null },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
        merged: { kind: 'value', value: 'theirs' },
      },
    ],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function checkoutMaterialization(commitId: typeof OURS | typeof MERGE) {
  return {
    strategy: 'fullSnapshot',
    commitId,
    resolvedTarget: {
      kind: 'ref',
      refName: BRANCH_NAME,
      commitId,
      refVersion: commitId === MERGE ? MERGE_REVISION : ACTIVE_REVISION,
      refIncarnationId: 'ref-incarnation:apply-merge-materialization-persistence',
    },
    snapshotRoot: {},
    plan: checkoutPlan(commitId),
  } as never;
}

function checkoutResult(commitId: typeof OURS | typeof MERGE) {
  return {
    ok: true,
    materialization: 'applied',
    plan: checkoutPlan(commitId),
    diagnostics: [],
    mutationGuarantee: 'workbook-state-materialized',
  };
}

function checkoutPlan(commitId: typeof OURS | typeof MERGE) {
  return {
    strategy: 'fullSnapshot',
    resolvedTarget: {
      kind: 'ref',
      refName: BRANCH_NAME,
      commitId,
      refVersion: commitId === MERGE ? MERGE_REVISION : ACTIVE_REVISION,
      refIncarnationId: 'ref-incarnation:apply-merge-materialization-persistence',
    },
    commitId,
    parentCommitIds: commitId === MERGE ? [OURS, THEIRS] : [BASE],
    snapshotRootDigest: DIGEST_A,
    semanticChangeSetDigest: DIGEST_B,
    mutationSegmentDigests: [],
    requiredDependencies: [],
    requiredDependencyDigests: [],
  };
}

type PersistedMarkerRecord = {
  readonly checkedOutCommitId: string;
  readonly branchName: string;
  readonly refHeadAtMaterialization: string;
  readonly updatedAt?: string;
};
