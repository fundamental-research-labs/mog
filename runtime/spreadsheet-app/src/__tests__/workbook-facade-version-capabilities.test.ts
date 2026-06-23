import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
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

type VersionFacadeResultCase = {
  readonly methodName: keyof VersionFacade & string;
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

const VERSION_FACADE_RESULT_CASES: readonly VersionFacadeResultCase[] = [
  {
    methodName: 'diff',
    capabilities: ['version:diff'],
    invoke: (version) =>
      version.diff(
        {} as Parameters<VersionFacade['diff']>[0],
        {} as Parameters<VersionFacade['diff']>[1],
      ),
  },
  {
    methodName: 'listReviews',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.listReviews(),
  },
  {
    methodName: 'getReview',
    capabilities: ['version:reviewRead'],
    invoke: (version) => version.getReview({ reviewId: 'review-1' }),
  },
  {
    methodName: 'createReview',
    capabilities: ['version:reviewWrite'],
    invoke: (version) => version.createReview({} as Parameters<VersionFacade['createReview']>[0]),
  },
  {
    methodName: 'appendReviewDecision',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.appendReviewDecision({} as Parameters<VersionFacade['appendReviewDecision']>[0]),
  },
  {
    methodName: 'updateReviewStatus',
    capabilities: ['version:reviewWrite'],
    invoke: (version) =>
      version.updateReviewStatus({} as Parameters<VersionFacade['updateReviewStatus']>[0]),
  },
  {
    methodName: 'getReviewDiff',
    capabilities: ['version:diff'],
    conditionalCapabilities: REVIEW_ID_SUPPLIED_CONDITIONAL_CAPABILITY,
    deniedCapabilities: ['version:diff', 'version:reviewRead'],
    invoke: (version) => version.getReviewDiff({ reviewId: 'review-1' }),
  },
  {
    methodName: 'createProposal',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.createProposal({} as Parameters<VersionFacade['createProposal']>[0]),
  },
  {
    methodName: 'startProposalWorkspace',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.startProposalWorkspace({} as Parameters<VersionFacade['startProposalWorkspace']>[0]),
  },
  {
    methodName: 'getProposalWorkspace',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.getProposalWorkspace({} as Parameters<VersionFacade['getProposalWorkspace']>[0]),
  },
  {
    methodName: 'disposeProposalWorkspace',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.disposeProposalWorkspace(
        {} as Parameters<VersionFacade['disposeProposalWorkspace']>[0],
      ),
  },
  {
    methodName: 'commitProposalWorkspace',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.commitProposalWorkspace(
        {} as Parameters<VersionFacade['commitProposalWorkspace']>[0],
      ),
  },
  {
    methodName: 'failProposal',
    capabilities: ['version:proposal'],
    invoke: (version) => version.failProposal({} as Parameters<VersionFacade['failProposal']>[0]),
  },
  {
    methodName: 'getProposal',
    capabilities: ['version:proposal'],
    invoke: (version) => version.getProposal({} as Parameters<VersionFacade['getProposal']>[0]),
  },
  {
    methodName: 'listProposals',
    capabilities: ['version:proposal'],
    invoke: (version) => version.listProposals({}),
  },
  {
    methodName: 'markProposalVerified',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.markProposalVerified({} as Parameters<VersionFacade['markProposalVerified']>[0]),
  },
  {
    methodName: 'openProposalReview',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.openProposalReview({} as Parameters<VersionFacade['openProposalReview']>[0]),
  },
  {
    methodName: 'acceptProposal',
    capabilities: ['version:proposal', 'version:branch'],
    deniedCapabilities: ['version:proposal', 'version:branch'],
    invoke: (version) =>
      version.acceptProposal({} as Parameters<VersionFacade['acceptProposal']>[0]),
  },
  {
    methodName: 'rejectProposal',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.rejectProposal({} as Parameters<VersionFacade['rejectProposal']>[0]),
  },
  {
    methodName: 'supersedeProposal',
    capabilities: ['version:proposal'],
    invoke: (version) =>
      version.supersedeProposal({} as Parameters<VersionFacade['supersedeProposal']>[0]),
  },
  {
    methodName: 'revert',
    capabilities: ['version:revert'],
    invoke: (version) => version.revert({} as Parameters<VersionFacade['revert']>[0]),
  },
  {
    methodName: 'promotePendingRemote',
    capabilities: ['version:remotePromote', 'version:provenance'],
    deniedCapabilities: ['version:remotePromote', 'version:provenance'],
    invoke: (version) => version.promotePendingRemote(),
  },
];

const VERSION_FACADE_SCALAR_FALLBACK_CASES = [
  'diff',
  'getReview',
  'createProposal',
  'revert',
  'promotePendingRemote',
] as const satisfies readonly VersionFacadeResultCase['methodName'][];

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

function assertVersionCapabilityEntry(testCase: VersionFacadeResultCase): void {
  const entry = mutableVersionMatrix()[testCase.methodName];
  assert.ok(entry, `WorkbookVersion.${testCase.methodName} matrix entry must exist`);
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.capability, undefined);
  assert.deepEqual(entry.capabilities, testCase.capabilities);
  assert.deepEqual(entry.conditionalCapabilities ?? [], testCase.conditionalCapabilities ?? []);
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

test('workbook version facade matrix covers explicit result capability families', () => {
  for (const testCase of VERSION_FACADE_RESULT_CASES) {
    assertVersionCapabilityEntry(testCase);
  }
});

test('workbook version facade denied result families return capability-unavailable results', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>(
    VERSION_FACADE_RESULT_CASES.flatMap((testCase) => testCase.capabilities),
  );

  await withVersionFacade(
    'runtime-version-result-facade-denied-families',
    deniedCapabilities,
    async (version) => {
      for (const testCase of VERSION_FACADE_RESULT_CASES) {
        const expectedCapability = testCase.capabilities[0];
        assert.ok(expectedCapability, `${testCase.methodName} must declare a capability`);
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

test('workbook version facade denied result paths support scalar capability fallback', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>(
    VERSION_FACADE_RESULT_CASES.flatMap((testCase) => testCase.capabilities),
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
            assertVersionDeniedResult(result, methodName, capability);
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
      for (const methodName of VERSION_FACADE_SCALAR_FALLBACK_CASES) {
        const testCase = versionCase(methodName);
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
