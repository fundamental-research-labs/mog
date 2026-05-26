import type { AppManifest, AppLoader, AppId } from '../types';
import { PackageRegistryService } from '../package-registry';
import { AppRegistryService } from '../app-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<AppManifest> & { id: string }): AppManifest {
  return {
    id: overrides.id,
    name: overrides.id,
    version: '1.0.0',
    description: 'Test app',
    author: 'Mog',
    icon: 'test-app',
    entry: { module: '@test/app', export: 'default' },
    kind: 'utility-app',
    compatibility: [{ profile: 'mog.app-platform/v1', versionRange: '>=0.1.0' }],
    capabilities: ['services:basic'],
    routes: [{ path: '/test' }],
    data: {},
    contributions: [],
    lifecycle: { suspendable: true },
    runtimeHost: 'same-realm-first-party',
    ...overrides,
  };
}

const dummyLoader: AppLoader = () =>
  Promise.resolve({ default: (() => null) as unknown as React.ComponentType<never> });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppRegistryService', () => {
  let packageRegistry: PackageRegistryService;
  let appRegistry: AppRegistryService;

  beforeEach(() => {
    packageRegistry = new PackageRegistryService();
    appRegistry = new AppRegistryService(packageRegistry);
  });

  it('lists only enabled apps', () => {
    packageRegistry.registerBuiltInPackage(makeManifest({ id: 'enabled-app' }), dummyLoader);
    packageRegistry.registerBuiltInPackage(makeManifest({ id: 'installed-app' }), dummyLoader);

    // Only enable the first one
    packageRegistry.enablePackage('enabled-app');

    const apps = appRegistry.listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].appId).toBe('enabled-app');
  });

  it('returns undefined for disabled apps', () => {
    packageRegistry.registerBuiltInPackage(makeManifest({ id: 'disabled-app' }), dummyLoader);
    packageRegistry.enablePackage('disabled-app');
    packageRegistry.disablePackage('disabled-app');

    expect(appRegistry.getApp('disabled-app' as AppId)).toBeUndefined();
  });

  it('returns undefined for unknown apps', () => {
    expect(appRegistry.getApp('nonexistent' as AppId)).toBeUndefined();
  });

  it('updates when package state changes', () => {
    packageRegistry.registerBuiltInPackage(makeManifest({ id: 'my-app' }), dummyLoader);

    // Before enabling
    expect(appRegistry.listApps()).toHaveLength(0);
    expect(appRegistry.getApp('my-app' as AppId)).toBeUndefined();

    // After enabling
    packageRegistry.enablePackage('my-app');
    expect(appRegistry.listApps()).toHaveLength(1);
    expect(appRegistry.getApp('my-app' as AppId)).toBeDefined();

    // After disabling
    packageRegistry.disablePackage('my-app');
    expect(appRegistry.listApps()).toHaveLength(0);
    expect(appRegistry.getApp('my-app' as AppId)).toBeUndefined();
  });

  it('getLoader returns loader for enabled app', () => {
    packageRegistry.registerBuiltInPackage(makeManifest({ id: 'loader-test' }), dummyLoader);
    packageRegistry.enablePackage('loader-test');

    expect(appRegistry.getLoader('loader-test' as AppId)).toBe(dummyLoader);
  });

  it('getManifest returns manifest for enabled app', () => {
    const manifest = makeManifest({ id: 'manifest-test', description: 'test desc' });
    packageRegistry.registerBuiltInPackage(manifest, dummyLoader);
    packageRegistry.enablePackage('manifest-test');

    const result = appRegistry.getManifest('manifest-test' as AppId);
    expect(result).toBeDefined();
    expect(result!.description).toBe('test desc');
  });
});
