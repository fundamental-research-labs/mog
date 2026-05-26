/**
 * Conformance tests — plugin denial.
 */

import { createIsolationEnforcer } from '../../isolation-enforcer';
import { createPluginActivationManager } from '../../plugin-activation-manager';
import { createShellTrustIntegration } from '../../trust-integration';
import type { PluginId, PluginManifest } from '../../types';

function createManager(bundledFirstPartyIds: readonly string[]) {
  return createPluginActivationManager({
    isolationEnforcer: createIsolationEnforcer(),
    trustIntegration: createShellTrustIntegration({ bundledFirstPartyIds }),
  });
}

describe('Plugin Denial', () => {
  it('plugin with current implementation unsupported isolation mode is denied activation', async () => {
    const manager = createManager(['sandbox-plugin']);
    const plugin: PluginManifest = {
      id: 'sandbox-plugin' as PluginId,
      name: 'Sandbox Plugin',
      version: '1.0.0',
      isolation: 'worker-sandbox',
    };
    manager.registerPlugin(plugin);

    const result = await manager.activatePlugin(plugin.id, { kind: 'shell' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('unsupportedIsolation');
    }
    expect(manager.getPluginState(plugin.id)).toBe('unsupportedIsolation');
  });

  it('plugin with supported isolation mode and bundled trust is allowed', async () => {
    const manager = createManager(['good-plugin']);
    const plugin: PluginManifest = {
      id: 'good-plugin' as PluginId,
      name: 'Good Plugin',
      version: '1.0.0',
      isolation: 'same-realm-trusted',
    };
    manager.registerPlugin(plugin);

    const result = await manager.activatePlugin(plugin.id, { kind: 'shell' });

    expect(result.success).toBe(true);
    expect(manager.getPluginState(plugin.id)).toBe('active');
    expect(manager.listActivePlugins().map((activation) => activation.pluginId)).toEqual([
      plugin.id,
    ]);
  });

  it('untrusted plugin is denied and remains out of the active set', async () => {
    const manager = createManager(['allowed-plugin']);
    const deniedPlugin: PluginManifest = {
      id: 'denied-plugin' as PluginId,
      name: 'Denied Plugin',
      version: '1.0.0',
      isolation: 'same-realm-trusted',
    };
    manager.registerPlugin(deniedPlugin);

    const allowedPlugin: PluginManifest = {
      id: 'allowed-plugin' as PluginId,
      name: 'Allowed Plugin',
      version: '1.0.0',
      isolation: 'same-realm-trusted',
    };
    manager.registerPlugin(allowedPlugin);

    const deniedResult = await manager.activatePlugin(deniedPlugin.id, { kind: 'shell' });
    const allowedResult = await manager.activatePlugin(allowedPlugin.id, { kind: 'shell' });

    expect(deniedResult.success).toBe(false);
    expect(manager.getPluginState(deniedPlugin.id)).toBe('denied');
    expect(allowedResult.success).toBe(true);
    expect(manager.getPluginState(allowedPlugin.id)).toBe('active');
    expect(manager.listActivePlugins().map((activation) => activation.pluginId)).toEqual([
      allowedPlugin.id,
    ]);
  });
});
