import type {
  VersionCapability,
  VersionCapabilityState,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import { firstDisabledAvailability } from '../../version-history-panel-action-utils';
import {
  getBranchAvailability,
  getCapabilityAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
} from '../version-action-availability';

import {
  ACTION_CASES,
  READ_UNAVAILABLE_REASON,
  SPLIT_CAPABILITY_CASES,
  STORAGE_UNAVAILABLE_REASON,
  TARGET_COMMIT_ID,
  VERSIONING_DISABLED_REASON,
  createSurfaceStatus,
  diagnostic,
  disabledCapability,
  expectDisabled,
  redactedDisabledCapability,
} from './version-action-availability.test-utils';

function getDirectMergeApplyAvailability(surface: VersionSurfaceStatus) {
  return firstDisabledAvailability(
    getCapabilityAvailability({ surface }, false, false, 'version:mergeApply'),
    getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
    getCapabilityAvailability({ surface }, false, false, 'version:branch'),
    getCapabilityAvailability({ surface }, false, false, 'version:checkout'),
  );
}

function omitSurfaceCapability(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): VersionSurfaceStatus {
  return {
    ...surface,
    capabilities: Object.fromEntries(
      Object.entries(surface.capabilities).filter(([candidate]) => candidate !== capability),
    ) as VersionSurfaceStatus['capabilities'],
  };
}

describe('version action availability capability contract', () => {
  it('uses the feature-gate disabled reason for every action', () => {
    const surface = createSurfaceStatus({ featureGateEnabled: false });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), VERSIONING_DISABLED_REASON);
    }
  });

  it('uses host capability denial reasons from the action capability state', () => {
    for (const action of ACTION_CASES) {
      const reason = `Host policy denies ${action.capability}.`;
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [action.capability]: disabledCapability(reason, 'hostCapability', false),
        },
      });

      expectDisabled(action.availability(surface), reason);
    }
  });

  it('keeps review, proposal, and merge-apply capability denials split independently', () => {
    for (const blockedAction of SPLIT_CAPABILITY_CASES) {
      const reason = `Host policy denies ${blockedAction.capability}.`;
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [blockedAction.capability]: disabledCapability(reason, 'hostCapability', false),
        },
      });

      for (const action of SPLIT_CAPABILITY_CASES) {
        const availability = getCapabilityAvailability(
          { surface },
          false,
          false,
          action.capability,
        );
        if (action.capability === blockedAction.capability) {
          expectDisabled(availability, reason);
        } else {
          expect(availability).toEqual({ enabled: true });
        }
      }
    }
  });

  it('does not let review, proposal, or merge-apply denials disable legacy actions', () => {
    const surface = createSurfaceStatus({
      capabilityOverrides: Object.fromEntries(
        SPLIT_CAPABILITY_CASES.map((action) => [
          action.capability,
          disabledCapability(`Host policy denies ${action.capability}.`, 'hostCapability', false),
        ]),
      ) as Partial<Record<VersionCapability, VersionCapabilityState>>,
    });

    for (const action of ACTION_CASES) {
      expect(action.availability(surface)).toEqual({ enabled: true });
    }
  });

  it('uses public fallback reasons when split capability denial reasons are redacted', () => {
    for (const action of SPLIT_CAPABILITY_CASES) {
      const surface = createSurfaceStatus({
        capabilityOverrides: {
          [action.capability]: redactedDisabledCapability('hostCapability', false),
        },
      });
      const availability = getCapabilityAvailability({ surface }, false, false, action.capability);

      expectDisabled(availability, action.fallbackReason);
      expect(availability.disabledReason).not.toContain('version:');
    }
  });

  it('requires checkout availability for direct merge apply materializing the active checkout', () => {
    const checkoutReason = 'Checkout denied before merge materialization.';
    const cases = [
      {
        surface: createSurfaceStatus({
          capabilityOverrides: {
            'version:checkout': disabledCapability(checkoutReason, 'hostCapability', false),
          },
        }),
        reason: checkoutReason,
        reasonId: 'version-capability-host-denied',
      },
      {
        surface: createSurfaceStatus({
          capabilityOverrides: {
            'version:checkout': redactedDisabledCapability('hostCapability', false),
          },
        }),
        reason: 'Checkout is unavailable.',
        reasonId: 'version-capability-host-denied',
      },
      {
        surface: omitSurfaceCapability(createSurfaceStatus(), 'version:checkout'),
        reason: 'Checkout is unavailable.',
        reasonId: 'version-capability-unavailable',
      },
    ] as const;

    for (const item of cases) {
      expect(
        getCapabilityAvailability({ surface: item.surface }, false, false, 'version:mergeApply'),
      ).toEqual({ enabled: true });
      expectDisabled(getDirectMergeApplyAvailability(item.surface), item.reason, item.reasonId);
    }
  });

  it('treats read availability as a shared action prerequisite', () => {
    const surface = createSurfaceStatus({
      capabilityOverrides: {
        'version:read': disabledCapability(READ_UNAVAILABLE_REASON, 'VC-04', true),
      },
    });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), READ_UNAVAILABLE_REASON);
    }
  });

  it('uses storage unavailable reasons from surface capabilities', () => {
    const surface = createSurfaceStatus({ storageReady: false });

    for (const action of ACTION_CASES) {
      expectDisabled(action.availability(surface), STORAGE_UNAVAILABLE_REASON);
    }
  });

  it('uses the semantic-reader unavailable reason for commit capability denial', () => {
    const reason = 'Normal provider-backed commits require a Rust semantic state reader.';
    const surface = createSurfaceStatus({
      capabilityOverrides: {
        'version:commit': disabledCapability(reason, 'storage', true),
      },
    });

    expectDisabled(getCommitAvailability({ surface }, false, false, 'Checkpoint'), reason);
    expect(
      getBranchAvailability({ surface }, false, false, 'scenario/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
  });

  it('blocks sensitive actions when public diagnostics report incomplete history', () => {
    const historyDiagnostic = diagnostic(
      'The workbook version graph is not initialized for this document.',
      'VERSION_GRAPH_UNINITIALIZED',
    );
    const surface = createSurfaceStatus({ diagnostics: [historyDiagnostic] });
    const historyReason = 'Version history is incomplete for this action.';

    expectDisabled(
      getCommitAvailability({ surface }, false, false, 'Checkpoint'),
      historyReason,
      'version-history-incomplete',
    );
    expectDisabled(
      getCheckoutAvailability({ surface }, false, false),
      historyReason,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:reviewRead'),
      historyReason,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:mergePreview'),
      historyReason,
      'version-history-incomplete',
    );
    expectDisabled(
      getCapabilityAvailability({ surface }, false, false, 'version:provenance'),
      historyReason,
      'version-history-incomplete',
    );
    expect(
      getBranchAvailability({ surface }, false, false, 'scenario/review', TARGET_COMMIT_ID),
    ).toEqual({ enabled: true });
    expect(getDiffAvailability({ surface }, false, false)).toEqual({ enabled: true });
    expectDisabled(
      getRemotePromoteAvailability({ surface }, false, false),
      historyReason,
      'version-history-incomplete',
    );
  });

  it('blocks host-denied capability diagnostics even when capability state is enabled', () => {
    const deniedMergeApply = diagnostic(
      'Host policy denies merge apply.',
      'version.surfaceStatus.hostCapabilityDenied',
      'hostCapability',
      { capability: 'version:mergeApply' },
    );
    const deniedRead = diagnostic(
      'Host policy denies version reads.',
      'version.surfaceStatus.hostCapabilityDenied',
      'hostCapability',
      { deniedCapabilities: ['version:read'] },
    );
    const mergeSurface = createSurfaceStatus({ diagnostics: [deniedMergeApply] });
    const readSurface = createSurfaceStatus({ diagnostics: [deniedRead] });

    expectDisabled(
      getCapabilityAvailability({ surface: mergeSurface }, false, false, 'version:mergeApply'),
      'Host policy denies this version capability.',
      'version-capability-host-denied',
    );
    expect(
      getCapabilityAvailability({ surface: mergeSurface }, false, false, 'version:reviewRead'),
    ).toEqual({ enabled: true });
    expectDisabled(
      getCommitAvailability({ surface: readSurface }, false, false, 'Checkpoint'),
      'Host policy denies this version capability.',
      'version-capability-host-denied',
    );
  });
});
