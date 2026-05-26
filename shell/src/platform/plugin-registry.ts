/**
 * Plugin Registry Service
 *
 * Minimal current implementation stub for the typed view over enabled plugin packages.
 * Plugins are declared but not broadly activated yet.
 *
 */

import type { AppManifest } from './types';
import type { IPackageRegistryService } from './package-registry';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PluginRegistryEntry {
  readonly pluginId: string;
  readonly manifest: AppManifest;
}

export interface IPluginRegistryService {
  getPlugin(pluginId: string): PluginRegistryEntry | undefined;
  listPlugins(): readonly PluginRegistryEntry[];
}

// ---------------------------------------------------------------------------
// Implementation (stub for current implementation)
// ---------------------------------------------------------------------------

export class PluginRegistryService implements IPluginRegistryService {
  constructor(private readonly _packageRegistry: IPackageRegistryService) {
    // Plugin filtering will be added when plugin-kind packages are supported.
    // For now this registry is always empty.
  }

  getPlugin(_pluginId: string): PluginRegistryEntry | undefined {
    // plugins are not activated yet
    return undefined;
  }

  listPlugins(): readonly PluginRegistryEntry[] {
    // plugins are not activated yet
    return [];
  }
}
