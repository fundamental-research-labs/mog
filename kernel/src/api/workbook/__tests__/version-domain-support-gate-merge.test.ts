import { jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';
import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT as CREATED_AT,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

function plannedCheckoutResult(commitId: VersionMergeInput['base']) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget: { kind: 'commit', commitId },
      requiredDependencies: [{ role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' }],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function mergeCapabilityRegistryMismatch(operation: 'merge' | 'applyMerge') {
  return expect.objectContaining({
    code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
    data: expect.objectContaining({
      operation,
      mutationGuarantee: 'no-write-attempted',
      payload: expect.objectContaining({
        diagnosticCode: 'domain-policy-registry-mismatch',
        domainId: 'cells.values',
        policyField: 'capabilityStates.merge',
        policyValue: 'contracted',
      }),
    }),
  });
}

describe('WorkbookVersion domain support manifest merge gate', () => {
  it('preserves supported commit and checkout behavior when public merge support is enabled', async () => {
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
    const checkout = jest.fn(async () => plannedCheckoutResult(BASE));
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        checkoutService: { checkout },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: true,
      value: { id: THEIRS },
    });
    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
      },
    });
    expect(commit).toHaveBeenCalled();
    expect(checkout).toHaveBeenCalled();
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'merge',
              payload: expect.objectContaining({
                diagnosticCode: 'schema-version-unsupported',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('routes merge preview after public merge capability validation passes', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toEqual({
      ok: true,
      value: mergeResult,
    });
    expect(merge).toHaveBeenCalledWith({ base: BASE, ours: OURS, theirs: THEIRS }, {});
  });

  it('blocks merge preview when the manifest downgrades merge state below the registry', async () => {
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
                    merge: 'contracted',
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'merge',
              payload: expect.objectContaining({
                diagnosticCode: 'domain-policy-registry-mismatch',
                domainId: 'cells.formulas',
                policyField: 'capabilityStates.merge',
                policyValue: 'contracted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks merge preview when detector rows expose an unsupported merge domain after public merge capability validation passes', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest({
          domains: [
            ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
            domainRow('view-state', { matrixRowId: 'view-state.selection-scroll' }),
          ],
        }),
        domainSupportManifestOptions: {
          now: NOW,
          requiredMatrixRowIds: [],
          detectorRows: [
            {
              matrixRowId: 'view-state.selection-scroll',
              domainId: 'view-state',
              present: true,
              detectorId: 'detector.view-state',
            },
          ],
        },
      },
    } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'merge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                domain: 'view-state',
                matrixRowId: 'view-state.selection-scroll',
                reason: 'unsupportedDetectedDomain',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('routes merge preview when detector rows stay inside the materializer domain surface', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: {
          now: NOW,
          detectorRows: [
            {
              matrixRowId: 'cells.values',
              domainId: 'cells.values',
              present: true,
              detectorId: 'detector.cells-values',
            },
          ],
        },
      },
    } as any);

    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toEqual({
      ok: true,
      value: mergeResult,
    });
    expect(merge).toHaveBeenCalledWith({ base: BASE, ours: OURS, theirs: THEIRS }, {});
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
        diagnostics: expect.arrayContaining([
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
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks applyMerge before previewing or invoking write services when policy write admission is block', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  writeAdmissionMode: 'block',
                })
              : domainRow(id),
          ),
        }),
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'write-admission-mode-blocked',
                domainId: 'cells.values',
                policyField: 'writeAdmissionMode',
                policyValue: 'block',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks applyMerge before previewing or invoking write services when detector rows expose an unsupported merge domain after public merge capability validation passes', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({
          domains: [
            ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
            domainRow('view-state', { matrixRowId: 'view-state.selection-scroll' }),
          ],
        }),
        domainSupportManifestOptions: {
          now: NOW,
          requiredMatrixRowIds: [],
          detectorRows: [
            {
              matrixRowId: 'view-state.selection-scroll',
              domainId: 'view-state',
              present: true,
              detectorId: 'detector.view-state',
            },
          ],
        },
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                domain: 'view-state',
                matrixRowId: 'view-state.selection-scroll',
                reason: 'unsupportedDetectedDomain',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('plans applyMerge preview after public merge capability validation passes', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      {
        mode: 'preview',
      },
    );
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks applyMerge before previewing or invoking write services when the manifest downgrades merge state below the registry', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    merge: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
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
        diagnostics: expect.arrayContaining([mergeCapabilityRegistryMismatch('applyMerge')]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});
