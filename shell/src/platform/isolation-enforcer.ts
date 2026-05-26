/**
 * Isolation Enforcer — centralized isolation policy enforcement.
 *
 * Determines whether an app or plugin may be launched/activated based on
 * its declared isolation/host mode and the associated trust record.
 *
 * Current rule: only `same-realm-first-party` / `same-realm-trusted` is
 * executable when trust source is `bundled-first-party`. All other
 * isolation modes are declared-valid in manifests but refuse activation
 * until their host bridges ship.
 *
 */

import type {
  AppManifest,
  PackageTrustRecord,
  PluginIsolationMode,
  PluginManifest,
  RuntimeHostMode,
} from './types';

// =============================================================================
// Decision type
// =============================================================================

export type IsolationDecision =
  | { allowed: true; mode: RuntimeHostMode | PluginIsolationMode }
  | { allowed: false; reason: string };

// =============================================================================
// Interface
// =============================================================================

export interface IIsolationEnforcer {
  canLaunchApp(manifest: AppManifest, trustRecord: PackageTrustRecord): IsolationDecision;
  canActivatePlugin(manifest: PluginManifest, trustRecord: PackageTrustRecord): IsolationDecision;
}

// =============================================================================
// Isolation modes that require bundled-first-party trust
// =============================================================================

const SAME_REALM_APP_MODES: ReadonlySet<RuntimeHostMode> = new Set(['same-realm-first-party']);

const SAME_REALM_PLUGIN_MODES: ReadonlySet<PluginIsolationMode> = new Set(['same-realm-trusted']);

/**
 * Isolation modes whose host bridges are not yet implemented.
 * Manifests may declare them, but activation is refused.
 */
const UNIMPLEMENTED_APP_MODES: ReadonlySet<RuntimeHostMode> = new Set([
  'iframe-sandbox',
  'worker-sandbox',
  'server-side',
  'remote-bridge',
]);

const UNIMPLEMENTED_PLUGIN_MODES: ReadonlySet<PluginIsolationMode> = new Set([
  'worker-sandbox',
  'iframe-sandbox',
  'server-side',
]);

// =============================================================================
// Implementation
// =============================================================================

export function createIsolationEnforcer(): IIsolationEnforcer {
  return {
    canLaunchApp(manifest: AppManifest, trustRecord: PackageTrustRecord): IsolationDecision {
      const mode = manifest.runtimeHost;

      if (mode === 'disabled') {
        return { allowed: false, reason: 'App host mode is disabled' };
      }

      // Same-realm modes require bundled-first-party trust
      if (SAME_REALM_APP_MODES.has(mode)) {
        if (trustRecord.trustSource !== 'bundled-first-party') {
          return {
            allowed: false,
            reason: `Host mode "${mode}" requires bundled-first-party trust, got "${trustRecord.trustSource}"`,
          };
        }
        return { allowed: true, mode };
      }

      // Sandboxed / remote modes are valid for any trust source
      // but not implemented yet
      if (UNIMPLEMENTED_APP_MODES.has(mode)) {
        return {
          allowed: false,
          reason: `Host mode "${mode}" is not yet implemented`,
        };
      }

      return { allowed: false, reason: `Unknown host mode "${mode}"` };
    },

    canActivatePlugin(
      manifest: PluginManifest,
      trustRecord: PackageTrustRecord,
    ): IsolationDecision {
      const mode = manifest.isolation;

      if (mode === 'disabled') {
        return { allowed: false, reason: 'Plugin isolation mode is disabled' };
      }

      // Same-realm modes require bundled-first-party trust
      if (SAME_REALM_PLUGIN_MODES.has(mode)) {
        if (trustRecord.trustSource !== 'bundled-first-party') {
          return {
            allowed: false,
            reason: `Isolation mode "${mode}" requires bundled-first-party trust, got "${trustRecord.trustSource}"`,
          };
        }
        return { allowed: true, mode };
      }

      // Sandboxed / server-side modes are valid for any trust source
      // but not implemented yet
      if (UNIMPLEMENTED_PLUGIN_MODES.has(mode)) {
        return {
          allowed: false,
          reason: `Isolation mode "${mode}" is not yet implemented`,
        };
      }

      return { allowed: false, reason: `Unknown isolation mode "${mode}"` };
    },
  };
}
