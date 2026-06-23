import { jest } from '@jest/globals';

import {
  capabilityState,
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';

describe('WorkbookVersion surface status read-only capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps read surfaces available and disables mutating capabilities when editing is false', async () => {
    const { version } = createSurfaceReadyVersionWithContext({
      featureGates: { editing: false },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.stage).toBe('readOnly');
    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:diff']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    for (const capability of [
      'version:commit',
      'version:branch',
      'version:checkout',
      'version:reviewWrite',
      'version:proposal',
      'version:mergeApply',
      'version:revert',
    ] as const) {
      expect(surface.capabilities[capability]).toMatchObject({
        enabled: false,
        dependency: 'featureGate',
        retryable: false,
      });
    }
    expect(capabilityState(surface, 'version:refAdmin')).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(capabilityState(surface, 'version:remotePromote')).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.editingDisabled',
    );
  });
});
