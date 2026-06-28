import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
import { createWorkbookFacade, type FacadeBinding } from '../workbook-facade';
import {
  WORKBOOK_FACADE_CAPABILITY_MATRIX,
  WORKBOOK_SUB_API_INTERFACES,
} from '../workbook-facade-capability-matrix';
import type {
  SpreadsheetCapability,
  SpreadsheetRuntime,
  SpreadsheetRuntimeOptions,
  SpreadsheetSaveRequest,
  SpreadsheetSaveResult,
  SpreadsheetWorkbookFacade,
} from '../public-types';
import type { WorkbookRecord } from '../runtime-types';

type VersionFacade = SpreadsheetWorkbookFacade['version'];
type VersionProposalPorcelainFacade = VersionFacade['proposals'];

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const TEST_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Runtime test' } as const;

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

function assertVersionDeniedResult(
  result: unknown,
  methodName: string,
  expectedCapability: SpreadsheetCapability,
  expectedDeniedCapabilities: readonly SpreadsheetCapability[] = [expectedCapability],
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
  assert.equal(
    error?.reason,
    `Capability "${expectedCapability}" is denied for ${operation}`,
  );
  assert.equal(error?.retryable, false);
  if (expectedDeniedCapabilities.length > 1) {
    assert.deepEqual(error?.diagnostics?.[0]?.data?.deniedCapabilities, expectedDeniedCapabilities);
  } else {
    assert.equal(error?.diagnostics, undefined);
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

test('workbook version proposal sub-api matrix is pinned to porcelain and advanced surfaces', () => {
  const subApis = WORKBOOK_SUB_API_INTERFACES as Record<
    string,
    Record<string, { readonly targetInterface?: string }>
  >;

  assert.equal(
    subApis.WorkbookVersion?.proposals?.targetInterface,
    'VersionProposalPorcelainApi',
  );
  assert.equal(
    subApis.VersionProposalPorcelainApi?.advanced?.targetInterface,
    'VersionProposalApi',
  );

  const porcelainMatrix = WORKBOOK_FACADE_CAPABILITY_MATRIX.VersionProposalPorcelainApi;
  assert.deepEqual(Object.keys(porcelainMatrix).sort(), ['create', 'get', 'list']);
  assert.deepEqual(porcelainMatrix.create.capabilities, ['version:proposal']);
  assert.deepEqual(porcelainMatrix.create.returns, ['VersionProposalHandle']);
  assert.equal(porcelainMatrix.create.returnsVersionResult, true);
  assert.deepEqual(porcelainMatrix.get.capabilities, ['version:proposal']);
  assert.deepEqual(porcelainMatrix.get.returns, ['VersionProposalHandle']);
  assert.equal(porcelainMatrix.get.returnsVersionResult, true);
  assert.deepEqual(porcelainMatrix.list.capabilities, ['version:proposal']);
  assert.equal(porcelainMatrix.list.returnsVersionResult, true);

  const advancedMatrix = WORKBOOK_FACADE_CAPABILITY_MATRIX.VersionProposalApi;
  assert.deepEqual(advancedMatrix.acceptProposal.capabilities, [
    'version:proposal',
    'version:mergePreview',
    'version:mergeApply',
  ]);
  assert.equal(advancedMatrix.acceptProposal.returnsVersionResult, true);
});

test('workbook version proposal namespace access is capability-free but methods are guarded', async () => {
  const deniedCapabilities = new Set<SpreadsheetCapability>([
    'version:proposal',
    'version:mergePreview',
    'version:mergeApply',
  ]);

  await withVersionFacade(
    'runtime-version-proposal-namespace-denied-methods',
    deniedCapabilities,
    async (version) => {
      const proposals = version.proposals;
      assert.equal(typeof proposals, 'object');
      assert.equal(typeof proposals.list, 'function');

      const listResult = await proposals.list({});
      assertVersionDeniedResult(
        listResult,
        'list',
        'version:proposal',
        ['version:proposal'],
        'VersionProposalPorcelainApi.list',
      );

      const createResult = await proposals.create({
        title: 'Facade matrix nested proposal',
        into: MAIN_REF,
        baseCommitId: COMMIT_A,
      } as Parameters<VersionProposalPorcelainFacade['create']>[0]);
      assertVersionDeniedResult(
        createResult,
        'create',
        'version:proposal',
        ['version:proposal'],
        'VersionProposalPorcelainApi.create',
      );

      const advanced = proposals.advanced;
      assert.equal(typeof advanced, 'object');
      assert.equal(typeof advanced.acceptProposal, 'function');

      const acceptResult = await advanced.acceptProposal({
        clientRequestId: 'accept-proposal-request',
        proposalId: 'proposal-1',
        expectedRevision: 1,
        expectedTargetHeadId: COMMIT_A,
        actor: TEST_AUTHOR,
        resolutionPolicy: 'fastForwardOnly',
      } as Parameters<VersionProposalPorcelainFacade['advanced']['acceptProposal']>[0]);
      assertVersionDeniedResult(
        acceptResult,
        'acceptProposal',
        'version:proposal',
        ['version:proposal', 'version:mergePreview', 'version:mergeApply'],
        'VersionProposalApi.acceptProposal',
      );
    },
  );
});

test('workbook facade wraps proposal handles returned from nested porcelain methods', async () => {
  let proposalHandle: Record<string, unknown>;
  proposalHandle = {
    proposal: { id: 'proposal-1', status: 'draft', revision: 1 },
    id: 'proposal-1',
    status: 'draft',
    revision: 1,
    refresh: async () => ({ ok: true, value: proposalHandle }),
    openWorkspace: async () => ({
      ok: true,
      value: {
        workspace: { workspaceId: 'workspace-1' },
        proposal: proposalHandle,
        workbook: async () => ({}),
        commit: async () => ({ ok: true, value: proposalHandle }),
        dispose: async () => ({ ok: true, value: { disposed: true } }),
      },
    }),
    markVerified: async () => ({ ok: true, value: proposalHandle }),
    markReadyForReview: async () => ({ ok: true, value: { reviewId: 'review-1' } }),
    accept: async () => ({ ok: true, value: { accepted: true } }),
    reject: async () => ({ ok: true, value: proposalHandle }),
    supersede: async () => ({ ok: true, value: proposalHandle }),
  };

  const workbook = {
    version: {
      proposals: {
        advanced: {},
        create: async () => ({ ok: true, value: proposalHandle }),
        get: async () => ({ ok: true, value: proposalHandle }),
        list: async () => ({ ok: true, value: { items: [] } }),
      },
    },
  };
  const actor = { actorId: 'reader', kind: 'user' } as const;
  const record = {
    workbookId: 'runtime-version-proposal-handle-wrap-workbook',
    epoch: 1,
    status: 'active',
    workbook,
  } as unknown as WorkbookRecord;
  const binding = {
    actor,
    brand: Symbol('test-facade-binding'),
    policy: {
      actor,
      workbookId: record.workbookId,
      epoch: record.epoch,
      decisions: [
        { capability: 'version:proposal', decision: 'allowed' },
        { capability: 'version:mergePreview', decision: 'denied' },
        { capability: 'version:mergeApply', decision: 'denied' },
      ],
    },
  } as unknown as FacadeBinding;
  const facade = createWorkbookFacade(record, binding);

  const createResult = await facade.version.proposals.create({
    title: 'Facade matrix nested proposal',
  });
  assert.equal(createResult.ok, true);
  assert.ok(createResult.ok);

  const acceptResult = await createResult.value.accept();
  assertVersionDeniedResult(
    acceptResult,
    'accept',
    'version:mergePreview',
    ['version:mergePreview', 'version:mergeApply'],
    'VersionProposalHandle.accept',
  );
});
