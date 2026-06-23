import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
import { VERSION_SURFACE_HOST_CAPABILITY_DENIED_DIAGNOSTIC_CODE } from '../version-surface-status';
import {
  WORKBOOK_FACADE_CAPABILITY_MATRIX,
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
type VersionSurfaceCapability = Extract<SpreadsheetCapability, `version:${string}`>;
type VersionSurfaceStatus = Awaited<ReturnType<VersionFacade['getSurfaceStatus']>>;

type VersionFacadeOperationKind = 'version-result' | 'throws-on-denied' | 'capability-free-status';

type VersionFacadeResultCase = {
  readonly methodName: keyof VersionFacade & string;
  readonly kind: VersionFacadeOperationKind;
  readonly capabilities: readonly SpreadsheetCapability[];
  readonly conditionalCapabilities?: SpreadsheetFacadeMatrixEntry['conditionalCapabilities'];
  readonly deniedCapabilities?: readonly SpreadsheetCapability[];
  readonly invoke: (version: VersionFacade) => Promise<unknown>;
};

const REVIEW_ID_SUPPLIED_CONDITIONAL_CAPABILITY = [
  {
    when: {
      argumentIndex: 0,
      path: ['reviewId'],
      presence: 'present',
    },
    capabilities: ['version:reviewRead'],
  },
] as const satisfies SpreadsheetFacadeMatrixEntry['conditionalCapabilities'];

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const TEST_BRANCH = 'refs/heads/scenario/facade-matrix' as const;
const TEST_REVISION = { kind: 'counter', value: '1' } as const;
const TEST_DIGEST = { algorithm: 'sha256', digest: 'd'.repeat(64) } as const;
const TEST_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Runtime test' } as const;
const TEST_REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
const TEST_VERIFICATION = {
  status: 'not_run',
  checks: [],
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

const WORKBOOK_VERSION_METHODS_THROUGH_W7 = [
  'acceptProposal',
  'appendReviewDecision',
  'applyMerge',
  'checkout',
  'commit',
  'commitProposalWorkspace',
  'createBranch',
  'createProposal',
  'createReview',
  'deleteBranch',
  'deleteRef',
  'diff',
  'disposeProposalWorkspace',
  'failProposal',
  'fastForwardBranch',
  'getHead',
  'getMergeConflictDetail',
  'getProposal',
  'getProposalWorkspace',
  'getRef',
  'getReview',
  'getReviewDiff',
  'getStatus',
  'getSurfaceStatus',
  'listCommits',
  'listProposals',
  'listRefs',
  'listReviews',
  'markProposalVerified',
  'merge',
  'openProposalReview',
  'promotePendingRemote',
  'putMergeResolutionPayload',
  'readRef',
  'rejectProposal',
  'revert',
  'saveMergeResolutions',
  'startProposalWorkspace',
  'supersedeProposal',
  'updateBranch',
  'updateReviewStatus',
] as const satisfies readonly (keyof VersionFacade & string)[];

const VERSION_FACADE_OPERATION_CASES: readonly VersionFacadeResultCase[] = [
  {
    methodName: 'acceptProposal',
    kind: 'version-result',
    capabilities: ['version:proposal', 'version:branch'],
    deniedCapabilities: ['version:proposal', 'version:branch'],
    invoke: (version) =>
      version.acceptProposal({
        clientRequestId: 'accept-proposal-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        expectedTargetHeadId: COMMIT_A,
        actor: TEST_AUTHOR,
        resolutionPolicy: 'fastForwardOnly',
      } as Parameters<VersionFacade['acceptProposal']>[0]),
  },
  {
    methodName: 'appendReviewDecision',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.appendReviewDecision({
        reviewId: 'review-1',
        expectedRevision: 1,
        clientRequestId: 'append-review-decision-request',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: TEST_AUTHOR,
          body: 'Looks good.',
        },
      } as Parameters<VersionFacade['appendReviewDecision']>[0]),
  },
  {
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
    methodName: 'checkout',
    kind: 'version-result',
    capabilities: ['version:checkout'],
    invoke: (version) =>
      version.checkout({ kind: 'commit', id: COMMIT_A } as Parameters<
        VersionFacade['checkout']
      >[0]),
  },
  {
    methodName: 'commit',
    kind: 'version-result',
    capabilities: ['version:commit'],
    invoke: (version) => version.commit({ message: 'Facade matrix test commit' }),
  },
  {
    methodName: 'commitProposalWorkspace',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.commitProposalWorkspace({
        clientRequestId: 'commit-proposal-workspace-request',
        proposalId: 'proposal-1',
        workspaceId: 'workspace-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
        message: 'Commit proposal workspace',
      } as Parameters<VersionFacade['commitProposalWorkspace']>[0]),
  },
  {
    methodName: 'createBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.createBranch({
        name: TEST_BRANCH,
        targetCommitId: COMMIT_A,
        expectedAbsent: true,
      } as Parameters<VersionFacade['createBranch']>[0]),
  },
  {
    methodName: 'createProposal',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.createProposal({
        clientRequestId: 'create-proposal-request',
        title: 'Facade matrix proposal',
        targetRef: MAIN_REF,
        baseCommitId: COMMIT_A,
        agentRunId: 'agent-run-1',
        agent: TEST_AUTHOR,
        redactionPolicy: TEST_REDACTION_POLICY,
      } as Parameters<VersionFacade['createProposal']>[0]),
  },
  {
    methodName: 'createReview',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.createReview({
        clientRequestId: 'create-review-request',
        subject: { kind: 'commitRange', baseCommitId: COMMIT_A, headCommitId: COMMIT_B },
        title: 'Facade matrix review',
        createdBy: TEST_AUTHOR,
        baseCommitId: COMMIT_A,
        headCommitId: COMMIT_B,
        redactionPolicy: TEST_REDACTION_POLICY,
      } as Parameters<VersionFacade['createReview']>[0]),
  },
  {
    methodName: 'deleteBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.deleteBranch({
        name: TEST_BRANCH,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionFacade['deleteBranch']>[0]),
  },
  {
    methodName: 'deleteRef',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.deleteRef({
        name: TEST_BRANCH,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionFacade['deleteRef']>[0]),
  },
  {
    methodName: 'diff',
    kind: 'version-result',
    capabilities: ['version:diff'],
    invoke: (version) => version.diff(COMMIT_A, COMMIT_B),
  },
  {
    methodName: 'disposeProposalWorkspace',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.disposeProposalWorkspace({
        clientRequestId: 'dispose-proposal-workspace-request',
        workspaceId: 'workspace-1',
        actor: TEST_AUTHOR,
      } as Parameters<VersionFacade['disposeProposalWorkspace']>[0]),
  },
  {
    methodName: 'failProposal',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.failProposal({
        clientRequestId: 'fail-proposal-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
        diagnostics: [],
      } as Parameters<VersionFacade['failProposal']>[0]),
  },
  {
    methodName: 'fastForwardBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.fastForwardBranch({
        name: TEST_BRANCH,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionFacade['fastForwardBranch']>[0]),
  },
  {
    methodName: 'getHead',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.getHead(),
  },
  {
    methodName: 'getMergeConflictDetail',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) =>
      version.getMergeConflictDetail({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
        redactionPolicyDigest: TEST_DIGEST,
        conflictId: 'conflict-1',
        expectedConflictDigest: TEST_DIGEST,
        valueRole: 'base',
        purpose: 'review',
      } as Parameters<VersionFacade['getMergeConflictDetail']>[0]),
  },
  {
    methodName: 'getProposal',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.getProposal({ proposalId: 'proposal-1' } as Parameters<
        VersionFacade['getProposal']
      >[0]),
  },
  {
    methodName: 'getProposalWorkspace',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.getProposalWorkspace({
        workspaceId: 'workspace-1',
      } as Parameters<VersionFacade['getProposalWorkspace']>[0]),
  },
  {
    methodName: 'getRef',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.getRef('HEAD'),
  },
  {
    methodName: 'getReview',
    kind: 'version-result',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.getReview({ reviewId: 'review-1' }),
  },
  {
    methodName: 'getReviewDiff',
    kind: 'version-result',
    capabilities: ['version:diff'],
    conditionalCapabilities: REVIEW_ID_SUPPLIED_CONDITIONAL_CAPABILITY,
    deniedCapabilities: ['version:diff', 'version:reviewRead'],
    invoke: (version) => version.getReviewDiff({ reviewId: 'review-1' }),
  },
  {
    methodName: 'getStatus',
    kind: 'throws-on-denied',
    capabilities: ['version:read'],
    invoke: (version) => version.getStatus(),
  },
  {
    methodName: 'getSurfaceStatus',
    kind: 'capability-free-status',
    capabilities: [],
    invoke: (version) => version.getSurfaceStatus(),
  },
  {
    methodName: 'listCommits',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.listCommits({}),
  },
  {
    methodName: 'listProposals',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) => version.listProposals({}),
  },
  {
    methodName: 'listRefs',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.listRefs({}),
  },
  {
    methodName: 'listReviews',
    kind: 'version-result',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.listReviews(),
  },
  {
    methodName: 'markProposalVerified',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.markProposalVerified({
        clientRequestId: 'mark-proposal-verified-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        verification: TEST_VERIFICATION,
        actor: TEST_AUTHOR,
      } as Parameters<VersionFacade['markProposalVerified']>[0]),
  },
  {
    methodName: 'merge',
    kind: 'version-result',
    capabilities: ['version:mergePreview'],
    invoke: (version) =>
      version.merge({
        base: COMMIT_A,
        ours: COMMIT_B,
        theirs: COMMIT_C,
      }),
  },
  {
    methodName: 'openProposalReview',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.openProposalReview({
        clientRequestId: 'open-proposal-review-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
      } as Parameters<VersionFacade['openProposalReview']>[0]),
  },
  {
    methodName: 'promotePendingRemote',
    kind: 'version-result',
    capabilities: ['version:remotePromote', 'version:provenance'],
    deniedCapabilities: ['version:remotePromote', 'version:provenance'],
    invoke: (version) => version.promotePendingRemote(),
  },
  {
    methodName: 'putMergeResolutionPayload',
    kind: 'version-result',
    capabilities: ['version:mergePreview', 'version:mergeApply'],
    deniedCapabilities: ['version:mergePreview', 'version:mergeApply'],
    invoke: (version) =>
      version.putMergeResolutionPayload({
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
      } as Parameters<VersionFacade['putMergeResolutionPayload']>[0]),
  },
  {
    methodName: 'readRef',
    kind: 'version-result',
    capabilities: ['version:read'],
    invoke: (version) => version.readRef('HEAD'),
  },
  {
    methodName: 'rejectProposal',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.rejectProposal({
        clientRequestId: 'reject-proposal-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
        reason: 'Rejected by facade matrix test',
      } as Parameters<VersionFacade['rejectProposal']>[0]),
  },
  {
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
    methodName: 'saveMergeResolutions',
    kind: 'version-result',
    capabilities: ['version:mergePreview', 'version:mergeApply'],
    deniedCapabilities: ['version:mergePreview', 'version:mergeApply'],
    invoke: (version) =>
      version.saveMergeResolutions({
        resultId: 'merge-result:facade-matrix',
        resultDigest: TEST_DIGEST,
        redactionPolicyDigest: TEST_DIGEST,
        resolutions: [],
      } as Parameters<VersionFacade['saveMergeResolutions']>[0]),
  },
  {
    methodName: 'startProposalWorkspace',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.startProposalWorkspace({
        clientRequestId: 'start-proposal-workspace-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
      } as Parameters<VersionFacade['startProposalWorkspace']>[0]),
  },
  {
    methodName: 'supersedeProposal',
    kind: 'version-result',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.supersedeProposal({
        clientRequestId: 'supersede-proposal-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        actor: TEST_AUTHOR,
        supersededByProposalId: 'proposal-2',
        reason: 'Superseded by facade matrix test',
      } as Parameters<VersionFacade['supersedeProposal']>[0]),
  },
  {
    methodName: 'updateBranch',
    kind: 'version-result',
    capabilities: ['version:branch'],
    invoke: (version) =>
      version.updateBranch({
        name: TEST_BRANCH,
        nextCommitId: COMMIT_B,
        expectedHead: COMMIT_A,
        expectedRefRevision: TEST_REVISION,
      } as Parameters<VersionFacade['updateBranch']>[0]),
  },
  {
    methodName: 'updateReviewStatus',
    kind: 'version-result',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.updateReviewStatus({
        reviewId: 'review-1',
        expectedRevision: 1,
        clientRequestId: 'update-review-status-request',
        status: 'approved',
        actor: TEST_AUTHOR,
      } as Parameters<VersionFacade['updateReviewStatus']>[0]),
  },
];

const VERSION_FACADE_RESULT_CASES = VERSION_FACADE_OPERATION_CASES.filter(
  (testCase) => testCase.kind === 'version-result',
);

const VERSION_FACADE_SCALAR_FALLBACK_CASES = VERSION_FACADE_RESULT_CASES.filter(
  (testCase) => testCase.capabilities.length > 0,
).map((testCase) => testCase.methodName);

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

function mutableVersionMatrix(): Record<string, SpreadsheetFacadeMatrixEntry> {
  return WORKBOOK_FACADE_CAPABILITY_MATRIX.WorkbookVersion as unknown as Record<
    string,
    SpreadsheetFacadeMatrixEntry
  >;
}

function versionCase(methodName: VersionFacadeResultCase['methodName']): VersionFacadeResultCase {
  const testCase = VERSION_FACADE_RESULT_CASES.find((entry) => entry.methodName === methodName);
  assert.ok(testCase, `missing test case for WorkbookVersion.${methodName}`);
  return testCase;
}

function operationCase(methodName: VersionFacadeResultCase['methodName']): VersionFacadeResultCase {
  const testCase = VERSION_FACADE_OPERATION_CASES.find((entry) => entry.methodName === methodName);
  assert.ok(testCase, `missing test case for WorkbookVersion.${methodName}`);
  return testCase;
}

function assertVersionCapabilityEntry(testCase: VersionFacadeResultCase): void {
  const entry = mutableVersionMatrix()[testCase.methodName];
  assert.ok(entry, `WorkbookVersion.${testCase.methodName} matrix entry must exist`);
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.capability, undefined);
  assert.deepEqual(entry.capabilities, testCase.capabilities);
  assert.deepEqual(entry.conditionalCapabilities ?? [], testCase.conditionalCapabilities ?? []);
  assert.ok(
    [
      ...(entry.capabilities ?? []),
      ...(entry.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
    ].every((capability) => capability.startsWith('version:')),
    `WorkbookVersion.${testCase.methodName} must not backfill generic workbook capabilities`,
  );
}

function assertVersionDeniedResult(
  result: unknown,
  methodName: string,
  expectedCapability: SpreadsheetCapability,
  expectedDeniedCapabilities: readonly SpreadsheetCapability[] = [expectedCapability],
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
  assert.equal(
    error?.reason,
    `Capability "${expectedCapability}" is denied for WorkbookVersion.${methodName}`,
  );
  assert.equal(error?.retryable, false);
  if (expectedDeniedCapabilities.length > 1) {
    assert.deepEqual(error?.diagnostics?.[0]?.data?.deniedCapabilities, expectedDeniedCapabilities);
  } else {
    assert.equal(error?.diagnostics, undefined);
  }
}

function assertUiRenderableVersionDeniedResult(
  result: unknown,
  methodName: string,
  expectedCapability: SpreadsheetCapability,
): void {
  assertVersionDeniedResult(result, methodName, expectedCapability);
  const error = (
    result as {
      readonly error?: {
        readonly reason?: unknown;
        readonly retryable?: unknown;
      };
    }
  ).error;
  assert.equal(typeof error?.reason, 'string');
  assert.ok(error.reason.length > 0, `${methodName} denied result must include renderable reason`);
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

function assertVersionResultEnvelope(result: unknown, methodName: string): void {
  assert.equal(typeof (result as { readonly ok?: unknown }).ok, 'boolean');
  if ((result as { readonly ok: boolean }).ok) {
    assert.ok(
      'value' in (result as Record<string, unknown>),
      `${methodName} result must have value`,
    );
    return;
  }

  const error = (result as { readonly error?: { readonly code?: unknown } }).error;
  assert.ok(error && typeof error === 'object', `${methodName} result must have error`);
  assert.equal(typeof error.code, 'string', `${methodName} error must have a code`);
}

async function withTemporaryVersionMatrixEntry<T>(
  methodName: string,
  replacement: SpreadsheetFacadeMatrixEntry | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const matrix = mutableVersionMatrix();
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

test('workbook version facade matrix is pinned to the W7 operation set', () => {
  const expected = [...WORKBOOK_VERSION_METHODS_THROUGH_W7].sort();
  const caseMethods = VERSION_FACADE_OPERATION_CASES.map((testCase) => testCase.methodName).sort();
  const matrixMethods = Object.keys(mutableVersionMatrix()).sort();

  assert.equal(new Set(caseMethods).size, caseMethods.length, 'operation cases must be unique');
  assert.deepEqual(caseMethods, expected);
  assert.deepEqual(matrixMethods, expected);
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
        assert.ok(expectedCapability, `${testCase.methodName} must declare a capability`);

        if (testCase.kind === 'throws-on-denied') {
          assert.throws(
            () => {
              void testCase.invoke(version);
            },
            new RegExp(
              `Capability "${expectedCapability}" is denied for WorkbookVersion\\.${testCase.methodName}`,
            ),
          );
          continue;
        }

        const result = await testCase.invoke(version);
        assertVersionDeniedResult(
          result,
          testCase.methodName,
          expectedCapability,
          testCase.deniedCapabilities,
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
      for (const methodName of ['checkout', 'listReviews', 'revert'] as const) {
        const testCase = versionCase(methodName);
        const [expectedCapability] = testCase.capabilities;
        assert.ok(expectedCapability, `${methodName} must declare a capability`);
        const result = await testCase.invoke(version);
        assertUiRenderableVersionDeniedResult(result, methodName, expectedCapability);
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
          assertVersionResultEnvelope(result, testCase.methodName);
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
      for (const methodName of VERSION_FACADE_SCALAR_FALLBACK_CASES) {
        const testCase = versionCase(methodName);
        const original = mutableVersionMatrix()[methodName];
        assert.ok(original, `WorkbookVersion.${methodName} matrix entry must exist`);
        const [capability] = testCase.capabilities;
        assert.ok(capability, `WorkbookVersion.${methodName} must declare a capability`);
        await withTemporaryVersionMatrixEntry(
          methodName,
          scalarVersionMatrixEntry(original, capability),
          async () => {
            const result = await testCase.invoke(version);
            assertVersionDeniedResult(
              result,
              methodName,
              capability,
              scalarFallbackDeniedCapabilities(testCase, capability),
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
      for (const methodName of WORKBOOK_VERSION_METHODS_THROUGH_W7) {
        const testCase = operationCase(methodName);
        await withTemporaryVersionMatrixEntry(methodName, undefined, async () => {
          assert.throws(
            () => {
              void testCase.invoke(version);
            },
            new RegExp(
              `WorkbookVersion\\.${methodName} is missing a workbook facade capability-matrix decision`,
            ),
          );
        });
      }
    },
  );
});

test('workbook version facade stale surface-status matrix entry fails closed before projection', async () => {
  await withVersionFacade(
    'runtime-version-surface-stale-matrix-entry',
    new Set<SpreadsheetCapability>(['version:checkout']),
    async (version) => {
      await withTemporaryVersionMatrixEntry('getSurfaceStatus', undefined, async () => {
        assert.throws(() => {
          void version.getSurfaceStatus();
        }, /WorkbookVersion\.getSurfaceStatus is missing a workbook facade capability-matrix decision/);
      });
    },
  );
});
