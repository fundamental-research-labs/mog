/**
 * Tests for PluginActivationManager
 */

import { createIsolationEnforcer } from '../isolation-enforcer';
import { createPluginActivationManager } from '../plugin-activation-manager';
import { createShellTrustIntegration } from '../trust-integration';
import type { PluginId, PluginInstanceState, PluginManifest } from '../types';

// =============================================================================
// Fixtures
// =============================================================================

const BUNDLED_IDS = ['builtin-plugin'] as const;

function makeManager() {
  const isolationEnforcer = createIsolationEnforcer();
  const trustIntegration = createShellTrustIntegration({
    bundledFirstPartyIds: BUNDLED_IDS,
  });
  return createPluginActivationManager({ isolationEnforcer, trustIntegration });
}

function builtinManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'builtin-plugin' as PluginId,
    name: 'Built-in Plugin',
    version: '1.0.0',
    isolation: 'same-realm-trusted',
    ...overrides,
  };
}

function thirdPartyManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'third-party-plugin' as PluginId,
    name: 'Third Party Plugin',
    version: '1.0.0',
    isolation: 'worker-sandbox',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('PluginActivationManager', () => {
  describe('registration', () => {
    it('registers a plugin with state "registered"', () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      expect(manager.getPluginState('builtin-plugin' as PluginId)).toBe('registered');
    });

    it('re-registration updates manifest but keeps state', () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest({ name: 'V1' }));
      manager.registerPlugin(builtinManifest({ name: 'V2' }));

      expect(manager.getPluginState('builtin-plugin' as PluginId)).toBe('registered');
    });

    it('returns undefined for unregistered plugin', () => {
      const manager = makeManager();
      expect(manager.getPluginState('nonexistent' as PluginId)).toBeUndefined();
    });
  });

  describe('activation', () => {
    it('activates a built-in same-realm-trusted plugin successfully', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      const result = await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.activation.state).toBe('active');
        expect(result.activation.pluginId).toBe('builtin-plugin');
      }
      expect(manager.getPluginState('builtin-plugin' as PluginId)).toBe('active');
    });

    it('fails for worker-sandbox plugin with "unsupportedIsolation" in current implementation', async () => {
      const manager = makeManager();
      // Register a third-party plugin with worker-sandbox isolation
      // Even if we override it to be "bundled" for trust, the isolation mode is blocked
      const isolationEnforcer = createIsolationEnforcer();
      const trustIntegration = createShellTrustIntegration({
        bundledFirstPartyIds: ['worker-plugin'],
      });
      const mgr = createPluginActivationManager({ isolationEnforcer, trustIntegration });

      mgr.registerPlugin({
        id: 'worker-plugin' as PluginId,
        name: 'Worker Plugin',
        version: '1.0.0',
        isolation: 'worker-sandbox',
      });

      const result = await mgr.activatePlugin('worker-plugin' as PluginId, { kind: 'shell' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('unsupportedIsolation');
        expect(result.message).toContain('not yet implemented');
      }
    });

    it('fails for disabled plugin', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest({ isolation: 'disabled' }));

      const result = await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('denied');
        expect(result.message).toContain('disabled');
      }
    });

    it('fails for unregistered plugin with "incompatible"', async () => {
      const manager = makeManager();
      const result = await manager.activatePlugin('nonexistent' as PluginId, { kind: 'shell' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('incompatible');
      }
    });

    it('fails for untrusted plugin with "denied"', async () => {
      const manager = makeManager();
      manager.registerPlugin(thirdPartyManifest());

      const result = await manager.activatePlugin('third-party-plugin' as PluginId, {
        kind: 'shell',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('denied');
      }
    });
  });

  describe('deactivation', () => {
    it('deactivates an active plugin, transitioning to inactive', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());
      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      await manager.deactivatePlugin('builtin-plugin' as PluginId);

      expect(manager.getPluginState('builtin-plugin' as PluginId)).toBe('inactive');
    });

    it('does nothing for a non-active plugin', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      // Plugin is 'registered', not 'active'
      await manager.deactivatePlugin('builtin-plugin' as PluginId);

      expect(manager.getPluginState('builtin-plugin' as PluginId)).toBe('registered');
    });

    it('does nothing for an unregistered plugin', async () => {
      const manager = makeManager();
      // Should not throw
      await manager.deactivatePlugin('nonexistent' as PluginId);
    });
  });

  describe('queries', () => {
    it('listActivePlugins returns only active plugins', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      expect(manager.listActivePlugins()).toHaveLength(0);

      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      const active = manager.listActivePlugins();
      expect(active).toHaveLength(1);
      expect(active[0].pluginId).toBe('builtin-plugin');
    });

    it('getActivation returns activation record', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());
      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      const activation = manager.getActivation('builtin-plugin' as PluginId);
      expect(activation).toBeDefined();
      expect(activation!.state).toBe('active');
      expect(activation!.activatedAt).toBeDefined();
    });
  });

  describe('state change events', () => {
    it('fires callback on activation', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      const transitions: Array<{ pluginId: PluginId; state: PluginInstanceState }> = [];
      manager.onStateChange((pluginId, state) => {
        transitions.push({ pluginId, state });
      });

      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      // Should see activating -> active
      expect(transitions).toEqual([
        { pluginId: 'builtin-plugin', state: 'activating' },
        { pluginId: 'builtin-plugin', state: 'active' },
      ]);
    });

    it('fires callback on deactivation', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());
      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      const transitions: Array<{ pluginId: PluginId; state: PluginInstanceState }> = [];
      manager.onStateChange((pluginId, state) => {
        transitions.push({ pluginId, state });
      });

      await manager.deactivatePlugin('builtin-plugin' as PluginId);

      expect(transitions).toEqual([
        { pluginId: 'builtin-plugin', state: 'deactivating' },
        { pluginId: 'builtin-plugin', state: 'inactive' },
      ]);
    });

    it('unsubscribe stops future callbacks', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest());

      const transitions: PluginInstanceState[] = [];
      const unsub = manager.onStateChange((_id, state) => {
        transitions.push(state);
      });

      unsub();

      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      expect(transitions).toHaveLength(0);
    });

    it('fires denied state on denied activation', async () => {
      const manager = makeManager();
      manager.registerPlugin(builtinManifest({ isolation: 'disabled' }));

      const transitions: PluginInstanceState[] = [];
      manager.onStateChange((_id, state) => {
        transitions.push(state);
      });

      await manager.activatePlugin('builtin-plugin' as PluginId, { kind: 'shell' });

      expect(transitions).toContain('denied');
    });
  });
});
