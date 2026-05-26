/**
 * App Registry Service
 *
 * Read-only typed view over enabled app packages in the PackageRegistryService.
 *
 */

import type { AppId, AppManifest, AppLoader } from './types';
import type { IPackageRegistryService } from './package-registry';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AppRegistryEntry {
  readonly appId: AppId;
  readonly manifest: AppManifest;
  readonly loader: AppLoader;
}

export interface IAppRegistryService {
  getApp(appId: AppId): AppRegistryEntry | undefined;
  listApps(): readonly AppRegistryEntry[];
  getLoader(appId: AppId): AppLoader | undefined;
  getManifest(appId: AppId): AppManifest | undefined;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AppRegistryService implements IAppRegistryService {
  constructor(private readonly packageRegistry: IPackageRegistryService) {}

  getApp(appId: AppId): AppRegistryEntry | undefined {
    const pkg = this.packageRegistry.getPackage(String(appId));
    if (!pkg || pkg.state !== 'enabled') return undefined;
    return {
      appId: String(pkg.manifest.id) as AppId,
      manifest: pkg.manifest,
      loader: pkg.loader,
    };
  }

  listApps(): readonly AppRegistryEntry[] {
    return this.packageRegistry
      .listPackages()
      .filter((pkg) => pkg.state === 'enabled')
      .map((pkg) => ({
        appId: String(pkg.manifest.id) as AppId,
        manifest: pkg.manifest,
        loader: pkg.loader,
      }));
  }

  getLoader(appId: AppId): AppLoader | undefined {
    return this.getApp(appId)?.loader;
  }

  getManifest(appId: AppId): AppManifest | undefined {
    return this.getApp(appId)?.manifest;
  }
}
