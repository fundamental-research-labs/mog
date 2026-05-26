/**
 * Tests for ShellTrustIntegration
 */

import { createShellTrustIntegration } from '../trust-integration';
import type { AppManifest, PluginManifest } from '../types';

// =============================================================================
// Fixtures
// =============================================================================

const BUNDLED_IDS = ['spreadsheet', 'crm', 'analytics'] as const;

function appManifest(id: string): AppManifest {
  return {
    id,
    name: `App ${id}`,
    version: '1.0.0',
    runtimeHost: 'same-realm-first-party',
  };
}

function pluginManifest(id: string): PluginManifest {
  return {
    id: id as any,
    name: `Plugin ${id}`,
    version: '1.0.0',
    isolation: 'same-realm-trusted',
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ShellTrustIntegration', () => {
  describe('evaluateAppLaunch', () => {
    it('bundled first-party app is allowed with auto-grant', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const decision = trust.evaluateAppLaunch('spreadsheet', appManifest('spreadsheet'));

      expect(decision.allowed).toBe(true);
      expect(decision.trustSource).toBe('bundled-first-party');
      expect(decision.autoGrant).toBe(true);
    });

    it('marketplace app does NOT auto-grant (unknown in current implementation)', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const decision = trust.evaluateAppLaunch('third-party', appManifest('third-party'));

      expect(decision.allowed).toBe(false);
      expect(decision.trustSource).toBe('unknown');
      expect(decision.autoGrant).toBe(false);
    });

    it('local-dev app follows local-dev policy (denied by default)', () => {
      const trust = createShellTrustIntegration({
        bundledFirstPartyIds: BUNDLED_IDS,
        allowLocalDev: false,
      });
      const decision = trust.evaluateAppLaunch('my-local-app', appManifest('my-local-app'));

      // Not in bundled list, so trust source is 'unknown', not 'local-dev'
      // In current implementation, non-bundled = unknown
      expect(decision.allowed).toBe(false);
    });

    it('returns correct trust decision for each bundled app', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });

      for (const id of BUNDLED_IDS) {
        const decision = trust.evaluateAppLaunch(id, appManifest(id));
        expect(decision.allowed).toBe(true);
        expect(decision.autoGrant).toBe(true);
      }
    });
  });

  describe('evaluatePluginActivation', () => {
    it('bundled first-party plugin is allowed', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const decision = trust.evaluatePluginActivation('spreadsheet', pluginManifest('spreadsheet'));

      expect(decision.allowed).toBe(true);
      expect(decision.trustSource).toBe('bundled-first-party');
    });

    it('unknown plugin is denied', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const decision = trust.evaluatePluginActivation(
        'unknown-plugin',
        pluginManifest('unknown-plugin'),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.trustSource).toBe('unknown');
    });
  });

  describe('getTrustRecord', () => {
    it('returns bundled-first-party record for bundled packages', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const record = trust.getTrustRecord('spreadsheet');

      expect(record).toBeDefined();
      expect(record!.trustSource).toBe('bundled-first-party');
      expect(record!.verifiedAt).toBeDefined();
    });

    it('returns unknown record for non-bundled packages', () => {
      const trust = createShellTrustIntegration({ bundledFirstPartyIds: BUNDLED_IDS });
      const record = trust.getTrustRecord('some-other');

      expect(record).toBeDefined();
      expect(record!.trustSource).toBe('unknown');
      expect(record!.verifiedAt).toBeUndefined();
    });
  });
});
