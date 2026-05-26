/**
 * Conformance tests — trust enforcement for app/plugin activation.
 */

import { createShellTrustIntegration } from '../../trust-integration';
import { SPREADSHEET_CANONICAL_MANIFEST } from '@mog/app-spreadsheet/src/canonical-manifest';
import type { PluginId, PluginManifest } from '../../types';

describe('Capability Enforcement', () => {
  it('bundled first-party apps are allowed and auto-granted on launch', () => {
    const trust = createShellTrustIntegration({
      bundledFirstPartyIds: ['spreadsheet'],
    });

    const decision = trust.evaluateAppLaunch('spreadsheet', SPREADSHEET_CANONICAL_MANIFEST);

    expect(decision.allowed).toBe(true);
    expect(decision.trustSource).toBe('bundled-first-party');
    expect(decision.autoGrant).toBe(true);
  });

  it('unknown apps are denied and do not receive auto-grants', () => {
    const trust = createShellTrustIntegration({
      bundledFirstPartyIds: ['spreadsheet'],
    });

    const decision = trust.evaluateAppLaunch('unknown-app', {
      ...SPREADSHEET_CANONICAL_MANIFEST,
      id: 'unknown-app' as typeof SPREADSHEET_CANONICAL_MANIFEST.id,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.trustSource).toBe('unknown');
    expect(decision.autoGrant).toBe(false);
  });

  it('bundled first-party plugins are allowed by trust policy', () => {
    const trust = createShellTrustIntegration({
      bundledFirstPartyIds: ['first-party-plugin'],
    });
    const manifest: PluginManifest = {
      id: 'first-party-plugin' as PluginId,
      name: 'First Party Plugin',
      version: '1.0.0',
      isolation: 'same-realm-trusted',
    };

    const decision = trust.evaluatePluginActivation('first-party-plugin', manifest);

    expect(decision.allowed).toBe(true);
    expect(decision.trustSource).toBe('bundled-first-party');
  });
});
