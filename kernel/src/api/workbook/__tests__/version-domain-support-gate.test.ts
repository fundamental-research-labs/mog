import { jest } from '@jest/globals';

import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
} from '@mog-sdk/contracts/versioning';
import type { VersionMergeInput, VersionMergeResult } from '@mog-sdk/contracts/api';
import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
} from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';

const CREATED_AT = '2026-06-21T00:00:00.000Z';
const NOW = new Date('2026-06-21T00:05:00.000Z');
const ONE_MINUTE_MS = 60 * 1000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;
const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const MERGE = `commit:sha256:${'4'.repeat(64)}` as VersionMergeInput['ours'];
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

function capabilityStates(
  state: VersionDomainCapabilityState = 'supported',
): VersionDomainCapabilityStateMap {
  return {
    capture: state,
    replay: state,
    diff: state,
    reviewAccess: state,
    checkout: state,
    merge: state,
    persistence: state,
    import: state,
    export: state,
  };
}

function domainRow(
  domainId: string,
  overrides: Partial<DomainCapabilityPolicyManifest> = {},
): DomainCapabilityPolicyManifest {
  return {
    domainId,
    domainClass: 'authored',
    capabilityStates: capabilityStates(),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    rolloutStage: 'headless-local',
    historyAccess: {
      readMode: 'full',
      writeMode: 'full',
      redactionPolicy: 'none',
    },
    redactionPolicy: 'none',
    ...overrides,
  };
}

function freshManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return {
    schemaVersion: '1',
    generatedAt: CREATED_AT,
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
    ...overrides,
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
        structural: {
          kind: 'metadata',
          changeId: 'merge-change-a1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
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

describe('WorkbookVersion domain support manifest gate', () => {
  it('blocks commit before invoking the write service when the manifest is stale', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: THEIRS,
        parents: [OURS],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One' },
      },
      diagnostics: [],
    }));
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({ generatedAt: '2026-06-20T00:00:00.000Z' }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: ONE_MINUTE_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'manifest-stale',
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit before invoking the write service when a required capability is not supported', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    capture: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'capability-state-blocked',
                domainId: 'cells.values',
                capabilityKey: 'capture',
                capabilityState: 'contracted',
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit when a manifest only carries the legacy scalar capabilityState', async () => {
    const commit = jest.fn();
    const legacyRow = domainRow('cells.values') as any;
    delete legacyRow.capabilityStates;
    legacyRow.capabilityState = 'supported';
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values' ? legacyRow : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'capability-states-missing',
                domainId: 'cells.values',
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks checkout before invoking materialization services when a required domain is missing', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        checkoutService: { checkout, planCheckout },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map(
            (id) => domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'required-domain-missing',
                domainId: 'cells.formulas',
              }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('blocks checkout based on checkout capability state', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        checkoutService: { checkout, planCheckout },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'sheets'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    checkout: 'not-started',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'capability-state-blocked',
                domainId: 'sheets',
                capabilityKey: 'checkout',
                capabilityState: 'not-started',
              }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('blocks merge preview before invoking the merge service when the manifest is invalid', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest({ schemaVersion: '999' }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'merge',
              payload: expect.objectContaining({
                diagnosticCode: 'schema-version-unsupported',
              }),
            }),
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks merge preview based on merge capability state', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.formulas'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    merge: 'opaque-blocking',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'merge',
              payload: expect.objectContaining({
                diagnosticCode: 'capability-state-blocked',
                domainId: 'cells.formulas',
                capabilityKey: 'merge',
                capabilityState: 'opaque-blocking',
              }),
            }),
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks applyMerge before previewing or invoking write services when the manifest is invalid', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({ schemaVersion: '999' }),
        domainSupportManifestOptions: { now: NOW },
      },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'schema-version-unsupported',
              }),
            }),
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('allows applyMerge to use the existing service path when the manifest is valid', async () => {
    const mergeResult = cleanMergeResult();
    const merge = jest.fn(async () => mergeResult);
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
    }));
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { mergeCommit },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        commitRef: { id: MERGE },
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );
    expect(mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        targetRef: TARGET_REF,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
      }),
    );
  });

  it('fails closed when an advertised required manifest source is missing', async () => {
    const readDomainSupportManifest = jest.fn(async () => null);
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        readDomainSupportManifest,
        requireDomainSupportManifest: true,
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    expect(readDomainSupportManifest).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
