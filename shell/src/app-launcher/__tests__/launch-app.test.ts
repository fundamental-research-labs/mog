/**
 * Tests for App Launcher
 *
 */

type Mock<T = any> = jest.Mock<T>;

import { appId as createAppId } from '@mog-sdk/kernel/security';
import type {
  AppManifestWithCapabilities,
  CapabilityType,
  IGatedAppKernelAPI,
} from '@mog-sdk/contracts/capabilities';

import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';

import {
  canLaunchWithoutConsent,
  getCapabilitiesRequiringConsent,
  launchApp,
  TRUSTED_FIRST_PARTY_APPS,
} from '../launch-app';
import { createShellCapabilityRegistry } from '../../services/capabilities';

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestManifest(
  id: string,
  required: (CapabilityType | string)[] = [],
  optional: Array<{ capability: CapabilityType | string; reason: string }> = [],
): AppManifestWithCapabilities {
  return {
    id,
    name: `Test App ${id}`,
    version: '1.0.0',
    capabilities: {
      required: required as any,
      optional: optional.map((o) => ({
        capability: o.capability as any,
        reason: o.reason,
      })),
    },
  };
}

function createMockGatedApi(): IGatedAppKernelAPI {
  return {
    capabilities: {
      has: jest.fn().mockReturnValue(true),
      list: jest.fn().mockReturnValue([]),
      isScoped: jest.fn().mockReturnValue(false),
      getScope: jest.fn().mockReturnValue(null),
      hasAccessTo: jest.fn().mockReturnValue(true),
      request: jest.fn().mockResolvedValue(true),
      onChange: jest.fn().mockReturnValue(() => {}),
      onExpiring: jest.fn().mockReturnValue(() => {}),
    },
    undoGroup: jest.fn(async (fn) => fn()),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('launchApp', () => {
  let registry: ICapabilityRegistry;
  let showConsentDialog: Mock;
  let createGatedApi: Mock;

  beforeEach(() => {
    registry = createShellCapabilityRegistry();
    showConsentDialog = jest.fn();
    createGatedApi = jest.fn().mockReturnValue(createMockGatedApi());
  });

  describe('first-party app handling', () => {
    it('should auto-grant capabilities for first-party apps', async () => {
      const manifest = createTestManifest('spreadsheet', ['cells:read', 'cells:write']);

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
        autoGrantFirstParty: true,
      });

      expect(result.success).toBe(true);
      expect(result.isFirstParty).toBe(true);
      expect(showConsentDialog).not.toHaveBeenCalled();

      // Verify capabilities were granted
      const appIdObj = createAppId('spreadsheet');
      expect(registry.hasCapability(appIdObj, 'cells:read')).toBe(true);
      expect(registry.hasCapability(appIdObj, 'cells:write')).toBe(true);
    });

    it('should not auto-grant for non-first-party apps', async () => {
      const manifest = createTestManifest('custom-app', ['cells:read']);

      showConsentDialog.mockResolvedValue({
        decision: 'allow',
        grantedCapabilities: ['cells:read'],
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
        autoGrantFirstParty: true,
      });

      expect(result.success).toBe(true);
      expect(result.isFirstParty).toBe(false);
      expect(showConsentDialog).toHaveBeenCalled();
    });

    it('should respect autoGrantFirstParty=false', async () => {
      const manifest = createTestManifest('spreadsheet', ['cells:read']);

      showConsentDialog.mockResolvedValue({
        decision: 'allow',
        grantedCapabilities: ['cells:read'],
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
        autoGrantFirstParty: false,
      });

      expect(result.success).toBe(true);
      expect(showConsentDialog).toHaveBeenCalled();
    });
  });

  describe('consent flow', () => {
    it('should show consent dialog when missing required capabilities', async () => {
      const manifest = createTestManifest('custom-app', ['tables:read', 'tables:write']);

      showConsentDialog.mockResolvedValue({
        decision: 'allow',
        grantedCapabilities: ['tables:read', 'tables:write'],
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(true);
      expect(showConsentDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          appManifest: manifest,
          requiredCapabilities: expect.any(Array),
        }),
      );
    });

    it('should block launch when user denies required capabilities', async () => {
      const manifest = createTestManifest('custom-app', ['cells:read']);

      showConsentDialog.mockResolvedValue({
        decision: 'deny',
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(false);
      expect(result.deniedCapabilities).toContain('cells:read');
    });

    it('should block launch when user cancels consent', async () => {
      const manifest = createTestManifest('custom-app', ['cells:read']);

      showConsentDialog.mockResolvedValue({
        decision: 'cancel',
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(false);
    });

    it('should not show consent dialog when all capabilities are already granted', async () => {
      const appIdObj = createAppId('custom-app');
      const manifest = createTestManifest('custom-app', ['cells:read']);

      // Pre-grant the capability
      registry.grant(appIdObj, 'cells:read');

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(true);
      expect(showConsentDialog).not.toHaveBeenCalled();
    });
  });

  describe('capability expansion', () => {
    it('should expand composite capabilities', async () => {
      const manifest = createTestManifest('custom-app', ['spreadsheet:full']);

      showConsentDialog.mockResolvedValue({
        decision: 'allow',
        grantedCapabilities: [
          'cells:read',
          'cells:write',
          'sheets:read',
          'sheets:create',
          'sheets:delete',
          'sheets:rename',
          'formulas:read',
          'formulas:write',
          'formatting:read',
          'formatting:write',
          'recalc:trigger',
        ],
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(true);
    });

    it('should expand capability dependencies', async () => {
      const appIdObj = createAppId('custom-app');
      const manifest = createTestManifest('custom-app', ['cells:write']);

      showConsentDialog.mockResolvedValue({
        decision: 'allow',
        grantedCapabilities: ['cells:write', 'cells:read'],
      });

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
      });

      expect(result.success).toBe(true);
      // cells:write implies cells:read, so both should be granted
      expect(registry.hasCapability(appIdObj, 'cells:write')).toBe(true);
      expect(registry.hasCapability(appIdObj, 'cells:read')).toBe(true);
    });
  });

  describe('gated API creation', () => {
    it('should call createGatedApi with effective capabilities', async () => {
      const manifest = createTestManifest('spreadsheet', ['cells:read']);

      await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
        autoGrantFirstParty: true,
      });

      expect(createGatedApi).toHaveBeenCalled();
      const [appIdArg, capsArg] = createGatedApi.mock.calls[0];
      expect(appIdArg).toBe('spreadsheet');
      expect(capsArg).toContain('cells:read');
    });

    it('should return the gated API in the result', async () => {
      const mockApi = createMockGatedApi();
      createGatedApi.mockReturnValue(mockApi);

      const manifest = createTestManifest('spreadsheet', ['cells:read']);

      const result = await launchApp({
        appManifest: manifest,
        registry,
        showConsentDialog,
        createGatedApi,
        autoGrantFirstParty: true,
      });

      expect(result.gatedApi).toBe(mockApi);
    });
  });
});

describe('canLaunchWithoutConsent', () => {
  let registry: ICapabilityRegistry;

  beforeEach(() => {
    registry = createShellCapabilityRegistry();
  });

  it('should return true for first-party apps with autoGrantFirstParty', () => {
    const manifest = createTestManifest('spreadsheet', ['cells:read', 'cells:write']);

    const result = canLaunchWithoutConsent(registry, manifest, true);

    expect(result).toBe(true);
  });

  it('should return true when all capabilities are already granted', () => {
    const appIdObj = createAppId('custom-app');
    const manifest = createTestManifest('custom-app', ['cells:read']);

    registry.grant(appIdObj, 'cells:read');

    const result = canLaunchWithoutConsent(registry, manifest, true);

    expect(result).toBe(true);
  });

  it('should return false when capabilities are missing', () => {
    const manifest = createTestManifest('custom-app', ['cells:read']);

    const result = canLaunchWithoutConsent(registry, manifest, true);

    expect(result).toBe(false);
  });
});

describe('getCapabilitiesRequiringConsent', () => {
  let registry: ICapabilityRegistry;

  beforeEach(() => {
    registry = createShellCapabilityRegistry();
  });

  it('should return empty array when all capabilities are granted', () => {
    const appIdObj = createAppId('custom-app');
    const manifest = createTestManifest('custom-app', ['cells:read', 'cells:write']);

    registry.grant(appIdObj, 'cells:read');
    registry.grant(appIdObj, 'cells:write');

    const result = getCapabilitiesRequiringConsent(registry, manifest);

    expect(result).toEqual([]);
  });

  it('should return missing capabilities', () => {
    const appIdObj = createAppId('custom-app');
    const manifest = createTestManifest('custom-app', ['cells:read', 'cells:write', 'tables:read']);

    registry.grant(appIdObj, 'cells:read');

    const result = getCapabilitiesRequiringConsent(registry, manifest);

    expect(result).toContain('cells:write');
    expect(result).toContain('tables:read');
    expect(result).not.toContain('cells:read');
  });
});

describe('TRUSTED_FIRST_PARTY_APPS', () => {
  it('should contain expected apps', () => {
    expect(TRUSTED_FIRST_PARTY_APPS.has('spreadsheet')).toBe(true);
    expect(TRUSTED_FIRST_PARTY_APPS.has('crm')).toBe(true);
    expect(TRUSTED_FIRST_PARTY_APPS.has('analytics')).toBe(true);
    expect(TRUSTED_FIRST_PARTY_APPS.has('finance')).toBe(true);
    expect(TRUSTED_FIRST_PARTY_APPS.has('bug-tracker')).toBe(true);
    expect(TRUSTED_FIRST_PARTY_APPS.has('form-builder')).toBe(true);
  });

  it('should not contain random apps', () => {
    expect(TRUSTED_FIRST_PARTY_APPS.has('malicious-app')).toBe(false);
    expect(TRUSTED_FIRST_PARTY_APPS.has('third-party')).toBe(false);
  });
});
