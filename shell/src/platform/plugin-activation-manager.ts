/**
 * Plugin Activation Manager — lifecycle management for shell plugins.
 *
 * Handles registration, activation (with isolation validation), deactivation,
 * crash handling, and state change events.
 *
 * Current only supports `same-realm-trusted` execution for bundled first-party
 * plugins. Other isolation modes are declared in manifests but refuse
 * activation with `unsupportedIsolation`.
 *
 */

import type { IIsolationEnforcer } from './isolation-enforcer';
import type { ShellTrustIntegration } from './trust-integration';
import type { PluginActivation, PluginId, PluginInstanceState, PluginManifest } from './types';

// =============================================================================
// Public types
// =============================================================================

export type PluginActivationTarget =
  | { kind: 'shell' }
  | { kind: 'app'; appId: string }
  | { kind: 'resource'; resourceKind: string };

export type ActivationResult =
  | { success: true; activation: PluginActivation }
  | {
      success: false;
      reason: 'denied' | 'unsupportedIsolation' | 'incompatible' | 'crashed';
      message: string;
    };

export type PluginStateChangeCallback = (pluginId: PluginId, state: PluginInstanceState) => void;

// =============================================================================
// Interface
// =============================================================================

export interface IPluginActivationManager {
  // Registration
  registerPlugin(manifest: PluginManifest): void;

  // Activation lifecycle
  activatePlugin(pluginId: PluginId, target: PluginActivationTarget): Promise<ActivationResult>;
  deactivatePlugin(pluginId: PluginId): Promise<void>;

  // Queries
  getPluginState(pluginId: PluginId): PluginInstanceState | undefined;
  getActivation(pluginId: PluginId): PluginActivation | undefined;
  listActivePlugins(): readonly PluginActivation[];

  // Events
  onStateChange(callback: PluginStateChangeCallback): () => void;
}

// =============================================================================
// Internal state
// =============================================================================

interface PluginRecord {
  manifest: PluginManifest;
  activation: PluginActivation;
}

// =============================================================================
// Implementation
// =============================================================================

export function createPluginActivationManager(deps: {
  isolationEnforcer: IIsolationEnforcer;
  trustIntegration: ShellTrustIntegration;
}): IPluginActivationManager {
  const { isolationEnforcer, trustIntegration } = deps;

  const plugins = new Map<PluginId, PluginRecord>();
  const listeners = new Set<PluginStateChangeCallback>();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function emitStateChange(pluginId: PluginId, state: PluginInstanceState): void {
    for (const cb of listeners) {
      try {
        cb(pluginId, state);
      } catch {
        // Swallow listener errors to avoid poisoning the lifecycle.
      }
    }
  }

  function transitionState(pluginId: PluginId, newState: PluginInstanceState): void {
    const record = plugins.get(pluginId);
    if (!record) return;

    const updatedActivation: PluginActivation = {
      ...record.activation,
      state: newState,
      ...(newState === 'active' ? { activatedAt: Date.now() } : {}),
      ...(newState === 'inactive' ? { deactivatedAt: Date.now() } : {}),
    };

    record.activation = updatedActivation;
    emitStateChange(pluginId, newState);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    registerPlugin(manifest: PluginManifest): void {
      if (plugins.has(manifest.id)) {
        // Re-registration updates the manifest but keeps the state.
        const existing = plugins.get(manifest.id)!;
        existing.manifest = manifest;
        return;
      }

      plugins.set(manifest.id, {
        manifest,
        activation: {
          pluginId: manifest.id,
          state: 'registered',
        },
      });
    },

    async activatePlugin(
      pluginId: PluginId,
      _target: PluginActivationTarget,
    ): Promise<ActivationResult> {
      const record = plugins.get(pluginId);
      if (!record) {
        return {
          success: false,
          reason: 'incompatible',
          message: `Plugin "${pluginId}" is not registered`,
        };
      }

      const { manifest } = record;

      // Disabled plugins always refuse
      if (manifest.isolation === 'disabled') {
        transitionState(pluginId, 'denied');
        return {
          success: false,
          reason: 'denied',
          message: `Plugin "${pluginId}" has isolation mode "disabled"`,
        };
      }

      // Trust check
      const trustDecision = trustIntegration.evaluatePluginActivation(pluginId, manifest);
      if (!trustDecision.allowed) {
        transitionState(pluginId, 'denied');
        return {
          success: false,
          reason: 'denied',
          message: trustDecision.reason ?? `Plugin "${pluginId}" is not trusted`,
        };
      }

      // Isolation check
      const trustRecord = trustIntegration.getTrustRecord(pluginId);
      if (!trustRecord) {
        transitionState(pluginId, 'denied');
        return {
          success: false,
          reason: 'denied',
          message: `No trust record for plugin "${pluginId}"`,
        };
      }

      const isolationDecision = isolationEnforcer.canActivatePlugin(manifest, trustRecord);
      if (!isolationDecision.allowed) {
        // Distinguish "not implemented yet" from "fundamentally denied"
        const isUnsupported = isolationDecision.reason.includes('not yet implemented');
        const newState: PluginInstanceState = isUnsupported ? 'unsupportedIsolation' : 'denied';
        transitionState(pluginId, newState);
        return {
          success: false,
          reason: isUnsupported ? 'unsupportedIsolation' : 'denied',
          message: isolationDecision.reason,
        };
      }

      // Activate
      transitionState(pluginId, 'activating');

      try {
        // In current implementation, same-realm-trusted plugins are activated synchronously.
        // Future: dynamic import of entry module, worker/iframe bridge setup.
        transitionState(pluginId, 'active');

        return {
          success: true,
          activation: record.activation,
        };
      } catch (err) {
        const diagnostics = err instanceof Error ? err.message : String(err);

        record.activation = {
          ...record.activation,
          state: 'crashed',
          crashDiagnostics: diagnostics,
        };
        emitStateChange(pluginId, 'crashed');

        return {
          success: false,
          reason: 'crashed',
          message: diagnostics,
        };
      }
    },

    async deactivatePlugin(pluginId: PluginId): Promise<void> {
      const record = plugins.get(pluginId);
      if (!record) return;
      if (record.activation.state !== 'active') return;

      transitionState(pluginId, 'deactivating');

      // Withdraw contributions, release leases, close channels.
      // In current implementation there are no active resources to tear down for
      // same-realm-trusted plugins — the transition is immediate.

      transitionState(pluginId, 'inactive');
    },

    getPluginState(pluginId: PluginId): PluginInstanceState | undefined {
      return plugins.get(pluginId)?.activation.state;
    },

    getActivation(pluginId: PluginId): PluginActivation | undefined {
      return plugins.get(pluginId)?.activation;
    },

    listActivePlugins(): readonly PluginActivation[] {
      const result: PluginActivation[] = [];
      for (const record of plugins.values()) {
        if (record.activation.state === 'active') {
          result.push(record.activation);
        }
      }
      return result;
    },

    onStateChange(callback: PluginStateChangeCallback): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
