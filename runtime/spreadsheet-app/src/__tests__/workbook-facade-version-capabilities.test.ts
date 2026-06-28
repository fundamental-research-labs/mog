import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
import { VERSION_SURFACE_HOST_CAPABILITY_DENIED_DIAGNOSTIC_CODE } from '../version-surface-status';
import {
  WORKBOOK_FACADE_CAPABILITY_MATRIX,
  WORKBOOK_SUB_API_INTERFACES,
  type SpreadsheetFacadeMatrixEntry,
} from '../workbook-facade-capability-matrix';
import type {
  SpreadsheetCapability,
  SpreadsheetRuntime,
  SpreadsheetRuntimeOptions,
  SpreadsheetSaveRequest,
  SpreadsheetSaveResult,
  SpreadsheetWorkbookFacade,
} from '../public-types';

type VersionFacade = SpreadsheetWorkbookFacade['version'];
type VersionRefsFacade = VersionFacade['refs'];
type VersionReviewAdvancedFacade = VersionFacade['reviews']['advanced'];
type VersionArtifactAdvancedFacade = VersionFacade['artifacts']['advanced'];
type VersionSurfaceCapability = Extract<SpreadsheetCapability, `version:${string}`>;
type VersionSurfaceStatus = Awaited<ReturnType<VersionFacade['getSurfaceStatus']>>;
type VersionMatrixInterface = 'WorkbookVersion' | 'WorkbookVersionRefsNamespace' | 'WorkbookVersionReviewApi' | 'VersionMergeReviewArtifactApi';

type VersionFacadeOperationKind = 'version-result' | 'throws-on-denied' | 'capability-free-status';

type VersionFacadeResultCase = {
  readonly interfaceName: VersionMatrixInterface;
  readonly methodName: string;
  readonly kind: VersionFacadeOperationKind;
  readonly capabilities: readonly SpreadsheetCapability[];
  readonly conditionalCapabilities?: SpreadsheetFacadeMatrixEntry['conditionalCapabilities'];
  readonly deniedCapabilities?: readonly SpreadsheetCapability[];
  readonly invoke: (version: VersionFacade) => unknown | Promise<unknown>;
};

const REVIEW_ID_SUPPLIED_CONDITIONAL_CAPABILITY = [{
  when: { argumentIndex: 0, path: ['reviewId'], presence: 'present' },
  capabilities: ['version:reviewRead'],
}] as const satisfies SpreadsheetFacadeMatrixEntry['conditionalCapabilities'];

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const TEST_BRANCH = 'refs/heads/scenario/facade-matrix' as const;
const TEST_REVISION = { kind: 'counter', value: '1' } as const;
const TEST_DIGEST = { algorithm: 'sha256', digest: 'd'.repeat(64) } as const;
const TEST_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Runtime test' } as const;
const TEST_REDACTION_POLICY = { mode: 'default', redactSecrets: true, redactExternalLinks: true, redactAgentTrace: true } as const;

const VERSION_MATRIX_INTERFACES = ['WorkbookVersion', 'WorkbookVersionRefsNamespace', 'WorkbookVersionReviewApi', 'VersionMergeReviewArtifactApi'] as const satisfies readonly VersionMatrixInterface[];

function operationMethods(interfaceName: VersionMatrixInterface): readonly string[] {
  return VERSION_FACADE_OPERATION_CASES.filter((testCase) => testCase.interfaceName === interfaceName).map((testCase) => testCase.methodName);
}

const VERSION_FACADE_OPERATION_CASES: readonly VersionFacadeResultCase[] = [
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'checkoutBranch',
    kind: 'version-result',
    capabilities: ['version:checkout'],
    invoke: (version) => version.checkoutBranch(TEST_BRANCH),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'checkoutCommit',
    kind: 'version-result',
    capabilities: ['version:checkout'],
    invoke: (version) => version.checkoutCommit(COMMIT_A),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'commitCurrent',
    kind: 'version-result',
    capabilities: ['version:commit'],
    invoke: (version) => version.commitCurrent({ message: 'Facade matrix current commit' }),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'createBranchFromCurrent',
    kind: 'version-result',
    capabilities: ['version:read', 'version:branch'],
    deniedCapabilities: ['version:read', 'version:branch'],
    invoke: (version) => version.createBranchFromCurrent(TEST_BRANCH),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffBranch',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffBranch(TEST_BRANCH, { against: MAIN_REF }),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffBranchOverview',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffBranchOverview(TEST_BRANCH, { against: MAIN_REF }),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffCurrent',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffCurrent(MAIN_REF),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffCurrentOverview',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffCurrentOverview(MAIN_REF),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffGroupDetail',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) =>
      version.diffGroupDetail(COMMIT_A, COMMIT_B, {
        groupId: 'group:facade-matrix',
      } as Parameters<VersionFacade['diffGroupDetail']>[2]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffOverview',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffOverview(COMMIT_A, COMMIT_B),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diffWorkingTree',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diffWorkingTree({}),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'getCurrent',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.getCurrent(),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'getMergeReview',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) =>
      version.getMergeReview({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
      } as Parameters<VersionFacade['getMergeReview']>[0]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'getStatus',
    kind: 'throws-on-denied',
    capabilities: ['version:read'],
    invoke: (version) => version.getStatus(),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'getSurfaceStatus',
    kind: 'capability-free-status',
    capabilities: [],
    invoke: (version) => version.getSurfaceStatus(),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'listBranches',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.listBranches({}),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'previewMerge',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) => version.previewMerge({ from: TEST_BRANCH, into: MAIN_REF }),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'applyMerge',
    kind: 'version-result',
    capabilities: ['version:mergePreview', 'version:mergeApply', 'version:branch'],
    deniedCapabilities: ['version:mergePreview', 'version:mergeApply', 'version:branch'],
    invoke: (version) =>
      version.applyMerge({
        base: COMMIT_A,
        ours: COMMIT_B,
        theirs: COMMIT_C,
      } as Parameters<VersionFacade['applyMerge']>[0]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'checkout',
    kind: 'version-result',
    capabilities: ['version:checkout'],
    invoke: (version) =>
      version.checkout({ kind: 'commit', id: COMMIT_A } as Parameters<
        VersionFacade['checkout']
      >[0]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'commit',
    kind: 'version-result',
    capabilities: ['version:commit'],
    invoke: (version) => version.commit({ message: 'Facade matrix test commit' }),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'createBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.refs.createBranch({
        name: TEST_BRANCH,
        targetCommitId: COMMIT_A,
        expectedAbsent: true,
      } as Parameters<VersionRefsFacade['createBranch']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'deleteBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.refs.deleteBranch({
        name: TEST_BRANCH,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionRefsFacade['deleteBranch']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'deleteRef',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.refs.deleteRef({
        name: TEST_BRANCH,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionRefsFacade['deleteRef']>[0]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'diff',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diff(COMMIT_A, COMMIT_B),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'fastForwardBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.refs.fastForwardBranch({
        name: TEST_BRANCH,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionRefsFacade['fastForwardBranch']>[0]),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'getHead',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.getHead(),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'getRef',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.refs.getRef('HEAD'),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'listCommits',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.listCommits({}),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'listRefs',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.refs.listRefs({}),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'merge',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) => version.merge({ base: COMMIT_A, ours: COMMIT_B, theirs: COMMIT_C }),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'promotePendingRemote',
    kind: 'version-result',
    capabilities: ['version:remotePromote', 'version:provenance'],
    deniedCapabilities: ['version:remotePromote', 'version:provenance'],
    invoke: (version) => version.refs.promotePendingRemote(),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'readRef',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.refs.readRef('HEAD'),
  },
  {
    interfaceName: 'WorkbookVersion',
    methodName: 'revert',
    kind: 'version-result',
    capabilities: ['version:revert'],
    invoke: (version) =>
      version.revert({
        target: { kind: 'commit', commitId: COMMIT_A },
        targetRef: MAIN_REF,
        reason: 'Facade matrix revert',
      } as Parameters<VersionFacade['revert']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionRefsNamespace',
    methodName: 'updateBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.refs.updateBranch({
        name: TEST_BRANCH,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionRefsFacade['updateBranch']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'appendReviewDecision',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.reviews.advanced.appendReviewDecision({
        reviewId: 'review-1',
        expectedRevision: 1,
        clientRequestId: 'append-review-decision-request',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: TEST_AUTHOR,
          body: 'Looks good.',
        },
      } as Parameters<VersionReviewAdvancedFacade['appendReviewDecision']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'createReview',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.reviews.advanced.createReview({
        clientRequestId: 'create-review-request',
        subject: { kind: 'commitRange', baseCommitId: COMMIT_A, headCommitId: COMMIT_B },
        title: 'Facade matrix review',
        createdBy: TEST_AUTHOR,
        baseCommitId: COMMIT_A,
        headCommitId: COMMIT_B,
        redactionPolicy: TEST_REDACTION_POLICY,
      } as Parameters<VersionReviewAdvancedFacade['createReview']>[0]),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'getReview',
    kind: 'version-result',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.reviews.advanced.getReview({ reviewId: 'review-1' }),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'getReviewDiff',
    kind: 'version-result',
    capabilities: ['version:diff'],
    conditionalCapabilities: REVIEW_ID_SUPPLIED_CONDITIONAL_CAPABILITY,
    deniedCapabilities: ['version:diff', 'version:reviewRead'],
    invoke: (version) => version.reviews.advanced.getReviewDiff({ reviewId: 'review-1' }),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'listReviews',
    kind: 'version-result',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.reviews.advanced.listReviews(),
  },
  {
    interfaceName: 'WorkbookVersionReviewApi',
    methodName: 'updateReviewStatus',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.reviews.advanced.updateReviewStatus({
        reviewId: 'review-1',
        expectedRevision: 1,
        clientRequestId: 'update-review-status-request',
        status: 'approved',
        actor: TEST_AUTHOR,
      } as Parameters<VersionReviewAdvancedFacade['updateReviewStatus']>[0]),
  },
  {
    interfaceName: 'VersionMergeReviewArtifactApi',
    methodName: 'getMergeConflictDetail',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) =>
      version.artifacts.advanced.getMergeConflictDetail({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
        redactionPolicyDigest: TEST_DIGEST,
        conflictId: 'conflict-1',
        expectedConflictDigest: TEST_DIGEST,
        valueRole: 'base',
        purpose: 'review',
      } as Parameters<VersionArtifactAdvancedFacade['getMergeConflictDetail']>[0]),
  },
  {
    interfaceName: 'VersionMergeReviewArtifactApi',
    methodName: 'putMergeResolutionPayload',
    kind: 'version-result',
    capabilities: ['version:mergePreview', 'version:mergeApply'],
    deniedCapabilities: ['version:mergePreview', 'version:mergeApply'],
    invoke: (version) =>
      version.artifacts.advanced.putMergeResolutionPayload({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
        redactionPolicyDigest: TEST_DIGEST,
        conflictId: 'conflict-1',
        expectedConflictDigest: TEST_DIGEST,
        optionId: 'option-1',
        kind: 'acceptOurs',
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_A, revision: TEST_REVISION },
        value: null,
        purpose: 'custom',
      } as Parameters<VersionArtifactAdvancedFacade['putMergeResolutionPayload']>[0]),
  },
  {
    interfaceName: 'VersionMergeReviewArtifactApi',
    methodName: 'saveMergeResolutions',
    kind: 'version-result',
    capabilities: ['version:mergePreview', 'version:mergeApply'],
    deniedCapabilities: ['version:mergePreview', 'version:mergeApply'],
    invoke: (version) =>
      version.artifacts.advanced.saveMergeResolutions({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
        redactionPolicyDigest: TEST_DIGEST,
        resolutions: [],
      } as Parameters<VersionArtifactAdvancedFacade['saveMergeResolutions']>[0]),
  },
];

const VERSION_FACADE_RESULT_CASES = VERSION_FACADE_OPERATION_CASES.filter(
  (testCase) => testCase.kind === 'version-result',
);

const VERSION_FACADE_SCALAR_FALLBACK_CASES = VERSION_FACADE_RESULT_CASES.filter(
  (testCase) => testCase.capabilities.length > 0,
);

function savedResult(request: SpreadsheetSaveRequest): SpreadsheetSaveResult {
  return {
    status: 'saved',
    workbookId: request.workbookId,
    epoch: request.epoch,
    dirtyEpoch: request.dirtyEpoch,
    changeSequence: request.changeSequence,
    saveRequestId: request.saveRequestId,
    bytesHash: request.bytesHash,
    baseVersionId: request.baseVersionId,
    versionId: `test-saved-${request.changeSequence}`,
  };
}

function runtimeOptions(
  runtimeId: string,
  deniedCapabilities: ReadonlySet<SpreadsheetCapability> = new Set(),
): SpreadsheetRuntimeOptions {
  return {
    runtimeId,
    host: {
      persistenceMode: 'host-owned-ephemeral',
      authority: {
        resolveActor(ref) {
          return {
            actorId: ref.actorId,
            kind: ref.kind ?? 'host',
            displayName: ref.displayName,
          };
        },
        authorize(_actor, capability) {
          return deniedCapabilities.has(capability)
            ? {
                decision: 'denied',
                policyVersion: 'runtime-test',
                reason: `denied ${capability}`,
              }
            : { decision: 'allowed', policyVersion: 'runtime-test' };
        },
      },
    },
    onSaveRequest: savedResult,
  };
}

function mutableMatrix(
  interfaceName: VersionMatrixInterface,
): Record<string, SpreadsheetFacadeMatrixEntry> {
  return WORKBOOK_FACADE_CAPABILITY_MATRIX[interfaceName] as unknown as Record<
    string,
    SpreadsheetFacadeMatrixEntry
  >;
}

function operationName(testCase: VersionFacadeResultCase): string {
  return `${testCase.interfaceName}.${testCase.methodName}`;
}

function versionCase(
  interfaceName: VersionMatrixInterface,
  methodName: string,
): VersionFacadeResultCase {
  const testCase = VERSION_FACADE_RESULT_CASES.find(
    (entry) => entry.interfaceName === interfaceName && entry.methodName === methodName,
  );
  assert.ok(testCase, `missing test case for ${interfaceName}.${methodName}`);
  return testCase;
}

function operationCase(
  interfaceName: VersionMatrixInterface,
  methodName: string,
): VersionFacadeResultCase {
  const testCase = VERSION_FACADE_OPERATION_CASES.find(
    (entry) => entry.interfaceName === interfaceName && entry.methodName === methodName,
  );
  assert.ok(testCase, `missing test case for ${interfaceName}.${methodName}`);
  return testCase;
}

function assertVersionCapabilityEntry(testCase: VersionFacadeResultCase): void {
  const entry = mutableMatrix(testCase.interfaceName)[testCase.methodName];
  assert.ok(entry, `${operationName(testCase)} matrix entry must exist`);
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.capability, undefined);
  assert.deepEqual(entry.capabilities, testCase.capabilities);
  assert.deepEqual(entry.conditionalCapabilities ?? [], testCase.conditionalCapabilities ?? []);
  assert.ok(
    [
      ...(entry.capabilities ?? []),
      ...(entry.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
    ].every((capability) => capability.startsWith('version:')),
    `${operationName(testCase)} must not backfill generic workbook capabilities`,
  );
}

function assertVersionDeniedResult(
  result: unknown,
  methodName: string,
  expectedCapability: SpreadsheetCapability,
  expectedDeniedCapabilities: readonly SpreadsheetCapability[],
  operation: string,
): void {
  assert.equal((result as { readonly ok?: unknown }).ok, false, `${methodName} should be denied`);
  const error = (
    result as {
      readonly error?: {
        readonly code?: string;
        readonly capability?: SpreadsheetCapability;
        readonly dependency?: string;
        readonly reason?: string;
        readonly retryable?: boolean;
        readonly diagnostics?: readonly {
          readonly data?: {
            readonly deniedCapabilities?: readonly SpreadsheetCapability[];
          };
        }[];
      };
    }
  ).error;
  assert.equal(error?.code, 'version_capability_unavailable');
  assert.equal(error?.capability, expectedCapability);
  assert.equal(error?.dependency, 'hostCapability');
  assert.equal(error?.reason, `Capability "${expectedCapability}" is denied for ${operation}`);
  assert.equal(error?.retryable, false);
  if (expectedDeniedCapabilities.length > 1) {
    assert.deepEqual(error?.diagnostics?.[0]?.data?.deniedCapabilities, expectedDeniedCapabilities);
  } else {
    assert.equal(error?.diagnostics, undefined);
  }
}

function assertUiRenderableVersionDeniedResult(
  result: unknown,
  testCase: VersionFacadeResultCase,
  expectedCapability: SpreadsheetCapability,
): void {
  assertVersionDeniedResult(
    result,
    testCase.methodName,
    expectedCapability,
    [expectedCapability],
    operationName(testCase),
  );
  const error = (
    result as {
      readonly error?: {
        readonly reason?: unknown;
        readonly retryable?: unknown;
      };
    }
  ).error;
  assert.equal(typeof error?.reason, 'string');
  assert.ok(
    error.reason.length > 0,
    `${operationName(testCase)} denied result must include renderable reason`,
  );
  assert.equal(error.retryable, false);
}

function assertProjectedHostDeniedCapability(
  status: VersionSurfaceStatus,
  capability: VersionSurfaceCapability,
): void {
  assert.deepEqual(status.capabilities[capability], {
    enabled: false,
    dependency: 'hostCapability',
    reason: `Host policy denies ${capability}.`,
    retryable: false,
  });
}

function assertHostCapabilityProjectionDiagnostic(
  status: VersionSurfaceStatus,
  expectedDeniedCapabilities: readonly VersionSurfaceCapability[],
): void {
  const diagnostic = status.diagnostics.find(
    (entry) => entry.code === VERSION_SURFACE_HOST_CAPABILITY_DENIED_DIAGNOSTIC_CODE,
  );
  assert.ok(diagnostic, 'projected status must include host capability diagnostic');
  assert.equal(diagnostic.severity, 'warning');
  assert.equal(diagnostic.dependency, 'hostCapability');
  assert.deepEqual(diagnostic.data?.deniedCapabilities, expectedDeniedCapabilities);
}

function scalarVersionMatrixEntry(
  entry: SpreadsheetFacadeMatrixEntry,
  capability: SpreadsheetCapability,
): SpreadsheetFacadeMatrixEntry {
  return {
    decision: entry.decision,
    capability,
    ...(entry.conditionalCapabilities
      ? { conditionalCapabilities: entry.conditionalCapabilities }
      : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.returns ? { returns: entry.returns } : {}),
    ...(entry.returnsVersionResult ? { returnsVersionResult: entry.returnsVersionResult } : {}),
  };
}

function scalarFallbackDeniedCapabilities(
  testCase: VersionFacadeResultCase,
  capability: SpreadsheetCapability,
): readonly SpreadsheetCapability[] {
  return [
    capability,
    ...(testCase.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
  ];
}

function assertVersionResultEnvelope(result: unknown, testCase: VersionFacadeResultCase): void {
  assert.equal(typeof (result as { readonly ok?: unknown }).ok, 'boolean');
  if ((result as { readonly ok: boolean }).ok) {
    assert.ok(
      'value' in (result as Record<string, unknown>),
      `${operationName(testCase)} result must have value`,
    );
    return;
  }

  const error = (result as { readonly error?: { readonly code?: unknown } }).error;
  assert.ok(error && typeof error === 'object', `${operationName(testCase)} result must have error`);
  assert.equal(typeof error.code, 'string', `${operationName(testCase)} error must have a code`);
}

async function withTemporaryVersionMatrixEntry<T>(
  interfaceName: VersionMatrixInterface,
  methodName: string,
  replacement: SpreadsheetFacadeMatrixEntry | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const matrix = mutableMatrix(interfaceName);
  const original = matrix[methodName];
  if (replacement) {
    matrix[methodName] = replacement;
  } else {
    delete matrix[methodName];
  }
  try {
    return await fn();
  } finally {
    if (original) {
      matrix[methodName] = original;
    } else {
      delete matrix[methodName];
    }
  }
}

async function withVersionFacade<T>(
  runtimeId: string,
  deniedCapabilities: ReadonlySet<SpreadsheetCapability>,
  fn: (version: VersionFacade) => Promise<T>,
): Promise<T> {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions(runtimeId, deniedCapabilities));
    await runtime.ready;
    const workbook = await runtime.openWorkbook({
      workbookId: `${runtimeId}-workbook`,
      source: { kind: 'blank' },
    });
    await workbook.ready;
    const actor = await workbook.resolveActor({ actorId: 'reader', kind: 'user' });
    return await fn(actor.getWorkbook().version);
  } finally {
    await runtime?.dispose();
  }
}

test('workbook version facade sub-api matrix exposes advanced namespaces', () => {
  const subApis = WORKBOOK_SUB_API_INTERFACES as Record<
    string,
    Record<string, { readonly targetInterface?: string }>
  >;

  assert.equal(subApis.WorkbookVersion?.graph, undefined);
  assert.equal(subApis.WorkbookVersion?.refs?.targetInterface, 'WorkbookVersionRefsNamespace');
  assert.equal(
    subApis.WorkbookVersion?.reviews?.targetInterface,
    'WorkbookVersionReviewNamespace',
  );
  assert.equal(
    subApis.WorkbookVersionReviewNamespace?.advanced?.targetInterface,
    'WorkbookVersionReviewApi',
  );
  assert.equal(
    subApis.WorkbookVersion?.artifacts?.targetInterface,
    'VersionMergeReviewArtifactNamespace',
  );
  assert.equal(
    subApis.VersionMergeReviewArtifactNamespace?.advanced?.targetInterface,
    'VersionMergeReviewArtifactApi',
  );

  assert.deepEqual(Object.keys(WORKBOOK_FACADE_CAPABILITY_MATRIX.WorkbookVersionReviewNamespace), []);
  assert.deepEqual(
    Object.keys(WORKBOOK_FACADE_CAPABILITY_MATRIX.VersionMergeReviewArtifactNamespace),
    [],
  );
});

test('workbook version facade matrix is pinned to namespaced operation sets', () => {
  const caseKeys = new Set(
    VERSION_FACADE_OPERATION_CASES.map((testCase) => operationName(testCase)),
  );

  assert.equal(
    caseKeys.size,
    VERSION_FACADE_OPERATION_CASES.length,
    'operation cases must be unique',
  );

  for (const interfaceName of VERSION_MATRIX_INTERFACES) {
    const caseMethods = [...operationMethods(interfaceName)].sort();
    const matrixMethods = Object.keys(mutableMatrix(interfaceName)).sort();

    assert.ok(caseMethods.length > 0, `${interfaceName} must have operation cases`);
    assert.deepEqual(matrixMethods, caseMethods, `${interfaceName} matrix keys`);
  }
});

test('workbook version facade matrix covers explicit result capability families', () => {
  for (const testCase of VERSION_FACADE_OPERATION_CASES) {
    assertVersionCapabilityEntry(testCase);
  }
});

test('workbook version facade denied result families return capability-unavailable results', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>(
    VERSION_FACADE_OPERATION_CASES.flatMap((testCase) => testCase.capabilities),
  );

  await withVersionFacade(
    'runtime-version-result-facade-denied-families',
    deniedCapabilities,
    async (version) => {
      for (const testCase of VERSION_FACADE_OPERATION_CASES) {
        if (testCase.kind === 'capability-free-status') {
          const result = await testCase.invoke(version);
          assert.equal((result as { readonly schemaVersion?: unknown }).schemaVersion, 1);
          continue;
        }

        const expectedCapability = testCase.capabilities[0];
        assert.ok(expectedCapability, `${operationName(testCase)} must declare a capability`);

        if (testCase.kind === 'throws-on-denied') {
          assert.throws(
            () => {
              void testCase.invoke(version);
            },
            new RegExp(
              `Capability "${expectedCapability}" is denied for ${testCase.interfaceName}\\.${testCase.methodName}`,
            ),
          );
          continue;
        }

        const result = await testCase.invoke(version);
        assertVersionDeniedResult(
          result,
          testCase.methodName,
          expectedCapability,
          testCase.deniedCapabilities ?? [expectedCapability],
          operationName(testCase),
        );
      }
    },
  );
});

test('workbook version surface projects actor policy denials for UI button gating', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>([
    'version:checkout',
    'version:reviewRead',
    'version:reviewWrite',
    'version:revert',
  ]);

  await withVersionFacade(
    'runtime-version-surface-policy-projection',
    deniedCapabilities,
    async (version) => {
      const status = await version.getSurfaceStatus();

      assertProjectedHostDeniedCapability(status, 'version:checkout');
      assertProjectedHostDeniedCapability(status, 'version:reviewRead');
      assertProjectedHostDeniedCapability(status, 'version:reviewWrite');
      assertProjectedHostDeniedCapability(status, 'version:revert');
      assertHostCapabilityProjectionDiagnostic(status, [
        'version:checkout',
        'version:reviewRead',
        'version:reviewWrite',
        'version:revert',
      ]);
    },
  );
});

test('workbook version facade denied review, revert, and checkout results stay UI-renderable', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>([
    'version:checkout',
    'version:reviewRead',
    'version:revert',
  ]);

  await withVersionFacade(
    'runtime-version-result-facade-ui-renderable-denials',
    deniedCapabilities,
    async (version) => {
      for (const testCase of [
        versionCase('WorkbookVersion', 'checkout'),
        versionCase('WorkbookVersion', 'revert'),
        versionCase('WorkbookVersionReviewApi', 'listReviews'),
      ]) {
        const [expectedCapability] = testCase.capabilities;
        assert.ok(expectedCapability, `${operationName(testCase)} must declare a capability`);
        const result = await testCase.invoke(version);
        assertUiRenderableVersionDeniedResult(result, testCase, expectedCapability);
      }
    },
  );
});

test('workbook version facade unsupported paths keep public VersionResult envelopes', async () => {
  await withVersionFacade(
    'runtime-version-result-facade-unsupported-result-envelopes',
    new Set(),
    async (version) => {
      for (const testCase of VERSION_FACADE_OPERATION_CASES) {
        const result = await testCase.invoke(version);
        if (testCase.kind === 'version-result') {
          assertVersionResultEnvelope(result, testCase);
          continue;
        }
        assert.equal((result as { readonly schemaVersion?: unknown }).schemaVersion, 1);
      }
    },
  );
});

test('workbook version facade denied result paths support scalar capability fallback', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>(
    VERSION_FACADE_OPERATION_CASES.flatMap((testCase) => testCase.capabilities),
  );

  await withVersionFacade(
    'runtime-version-result-facade-scalar-denied-fallback',
    deniedCapabilities,
    async (version) => {
      for (const testCase of VERSION_FACADE_SCALAR_FALLBACK_CASES) {
        const original = mutableMatrix(testCase.interfaceName)[testCase.methodName];
        assert.ok(original, `${operationName(testCase)} matrix entry must exist`);
        const [capability] = testCase.capabilities;
        assert.ok(capability, `${operationName(testCase)} must declare a capability`);
        await withTemporaryVersionMatrixEntry(
          testCase.interfaceName,
          testCase.methodName,
          scalarVersionMatrixEntry(original, capability),
          async () => {
            const result = await testCase.invoke(version);
            assertVersionDeniedResult(
              result,
              testCase.methodName,
              capability,
              scalarFallbackDeniedCapabilities(testCase, capability),
              operationName(testCase),
            );
          },
        );
      }
    },
  );
});

test('workbook version facade missing matrix entries fail closed for result families', async () => {
  await withVersionFacade(
    'runtime-version-result-facade-missing-matrix-entry',
    new Set(),
    async (version) => {
      for (const interfaceName of VERSION_MATRIX_INTERFACES) {
        for (const methodName of operationMethods(interfaceName)) {
          const testCase = operationCase(interfaceName, methodName);
          await withTemporaryVersionMatrixEntry(interfaceName, methodName, undefined, async () => {
            assert.throws(
              () => {
                void testCase.invoke(version);
              },
              new RegExp(
                `${interfaceName}\\.${methodName} is missing a workbook facade capability-matrix decision`,
              ),
            );
          });
        }
      }
    },
  );
});

test('workbook version facade stale surface-status matrix entry fails closed before projection', async () => {
  await withVersionFacade(
    'runtime-version-surface-stale-matrix-entry',
    new Set<SpreadsheetCapability>(['version:checkout']),
    async (version) => {
      await withTemporaryVersionMatrixEntry(
        'WorkbookVersion',
        'getSurfaceStatus',
        undefined,
        async () => {
          assert.throws(() => {
            void version.getSurfaceStatus();
          }, /WorkbookVersion\.getSurfaceStatus is missing a workbook facade capability-matrix decision/);
        },
      );
    },
  );
});
