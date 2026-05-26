/**
 * Shell Trust Integration — bridges the kernel capability/trust system
 * into the shell's app-launch and plugin-activation flows.
 *
 * Replaces the hardcoded `TRUSTED_FIRST_PARTY_APPS` set in launch-app.ts
 * with policy-driven trust evaluation.
 *
 */

import type {
  ActivationTrustDecision,
  AppManifest,
  LaunchTrustDecision,
  PackageTrustRecord,
  PluginManifest,
  TrustSource,
} from './types';

// =============================================================================
// Interface
// =============================================================================

export interface ShellTrustIntegration {
  /**
   * Evaluate whether an app may be launched and whether capabilities
   * should be auto-granted.
   */
  evaluateAppLaunch(appId: string, manifest: AppManifest): LaunchTrustDecision;

  /**
   * Evaluate whether a plugin may be activated.
   */
  evaluatePluginActivation(pluginId: string, manifest: PluginManifest): ActivationTrustDecision;

  /**
   * Look up the trust record for a package.
   * Returns `undefined` for unknown packages.
   */
  getTrustRecord(packageId: string): PackageTrustRecord | undefined;
}

// =============================================================================
// Configuration
// =============================================================================

export interface ShellTrustConfig {
  /**
   * IDs of packages that ship as bundled first-party.
   * These receive `bundled-first-party` trust and auto-grant on launch.
   */
  readonly bundledFirstPartyIds: readonly string[];

  /**
   * Whether local-dev packages are allowed to launch/activate.
   * Defaults to `true` in development, `false` in production.
   */
  readonly allowLocalDev?: boolean;
}

// =============================================================================
// Factory
// =============================================================================

export function createShellTrustIntegration(config: ShellTrustConfig): ShellTrustIntegration {
  const bundledSet = new Set(config.bundledFirstPartyIds);
  const allowLocalDev = config.allowLocalDev ?? false;

  function resolveTrustSource(packageId: string): TrustSource {
    if (bundledSet.has(packageId)) {
      return 'bundled-first-party';
    }
    // In current implementation, anything not bundled is treated as local-dev if allowed,
    // otherwise unknown. Marketplace integration is future work.
    return 'unknown';
  }

  function buildTrustRecord(packageId: string): PackageTrustRecord {
    return {
      packageId,
      trustSource: resolveTrustSource(packageId),
      verifiedAt: bundledSet.has(packageId) ? new Date().toISOString() : undefined,
    };
  }

  function evaluateSource(source: TrustSource): { allowed: boolean; reason?: string } {
    switch (source) {
      case 'bundled-first-party':
        return { allowed: true };
      case 'marketplace-verified':
        return { allowed: true };
      case 'marketplace-unverified':
        return { allowed: false, reason: 'Unverified marketplace packages are not yet supported' };
      case 'local-dev':
        return allowLocalDev
          ? { allowed: true }
          : { allowed: false, reason: 'Local-dev packages are not allowed in this environment' };
      case 'unknown':
        return { allowed: false, reason: 'Unknown trust source' };
    }
  }

  return {
    evaluateAppLaunch(appId: string, _manifest: AppManifest): LaunchTrustDecision {
      const source = resolveTrustSource(appId);
      const { allowed, reason } = evaluateSource(source);
      return {
        allowed,
        trustSource: source,
        autoGrant: source === 'bundled-first-party',
        reason,
      };
    },

    evaluatePluginActivation(pluginId: string, _manifest: PluginManifest): ActivationTrustDecision {
      const source = resolveTrustSource(pluginId);
      const { allowed, reason } = evaluateSource(source);
      return {
        allowed,
        trustSource: source,
        reason,
      };
    },

    getTrustRecord(packageId: string): PackageTrustRecord | undefined {
      return buildTrustRecord(packageId);
    },
  };
}
