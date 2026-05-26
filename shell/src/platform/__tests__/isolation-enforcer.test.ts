/**
 * Tests for IsolationEnforcer
 */

import { createIsolationEnforcer } from '../isolation-enforcer';
import type { AppManifest, PackageTrustRecord, PluginManifest } from '../types';

// =============================================================================
// Fixtures
// =============================================================================

function appManifest(overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    runtimeHost: 'same-realm-first-party',
    ...overrides,
  };
}

function pluginManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin' as any,
    name: 'Test Plugin',
    version: '1.0.0',
    isolation: 'same-realm-trusted',
    ...overrides,
  };
}

function trustRecord(overrides: Partial<PackageTrustRecord> = {}): PackageTrustRecord {
  return {
    packageId: 'test',
    trustSource: 'bundled-first-party',
    ...overrides,
  };
}

// =============================================================================
// App isolation
// =============================================================================

describe('IsolationEnforcer', () => {
  const enforcer = createIsolationEnforcer();

  describe('canLaunchApp', () => {
    it('allows same-realm-first-party for bundled trust', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'same-realm-first-party' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.mode).toBe('same-realm-first-party');
      }
    });

    it('denies same-realm-first-party for marketplace trust', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'same-realm-first-party' }),
        trustRecord({ trustSource: 'marketplace-verified' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('bundled-first-party');
      }
    });

    it('denies same-realm-first-party for local-dev trust', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'same-realm-first-party' }),
        trustRecord({ trustSource: 'local-dev' }),
      );
      expect(decision.allowed).toBe(false);
    });

    it('blocks iframe-sandbox in current implementation (not yet implemented)', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'iframe-sandbox' }),
        trustRecord({ trustSource: 'marketplace-verified' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('not yet implemented');
      }
    });

    it('blocks worker-sandbox in current implementation', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'worker-sandbox' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('not yet implemented');
      }
    });

    it('blocks server-side in current implementation', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'server-side' }),
        trustRecord(),
      );
      expect(decision.allowed).toBe(false);
    });

    it('blocks remote-bridge in current implementation', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'remote-bridge' }),
        trustRecord(),
      );
      expect(decision.allowed).toBe(false);
    });

    it('always blocks disabled', () => {
      const decision = enforcer.canLaunchApp(
        appManifest({ runtimeHost: 'disabled' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('disabled');
      }
    });
  });

  // ===========================================================================
  // Plugin isolation
  // ===========================================================================

  describe('canActivatePlugin', () => {
    it('allows same-realm-trusted for bundled trust', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'same-realm-trusted' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.mode).toBe('same-realm-trusted');
      }
    });

    it('denies same-realm-trusted for marketplace trust', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'same-realm-trusted' }),
        trustRecord({ trustSource: 'marketplace-verified' }),
      );
      expect(decision.allowed).toBe(false);
    });

    it('denies same-realm-trusted for local-dev trust', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'same-realm-trusted' }),
        trustRecord({ trustSource: 'local-dev' }),
      );
      expect(decision.allowed).toBe(false);
    });

    it('blocks worker-sandbox in current implementation (manifest valid, activation refused)', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'worker-sandbox' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('not yet implemented');
      }
    });

    it('blocks iframe-sandbox in current implementation', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'iframe-sandbox' }),
        trustRecord({ trustSource: 'marketplace-verified' }),
      );
      expect(decision.allowed).toBe(false);
    });

    it('blocks server-side in current implementation', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'server-side' }),
        trustRecord(),
      );
      expect(decision.allowed).toBe(false);
    });

    it('always blocks disabled', () => {
      const decision = enforcer.canActivatePlugin(
        pluginManifest({ isolation: 'disabled' }),
        trustRecord({ trustSource: 'bundled-first-party' }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('disabled');
      }
    });
  });
});
