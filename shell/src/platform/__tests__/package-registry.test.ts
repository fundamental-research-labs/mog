import type { AppManifest, AppLoader } from '../types';
import { PackageRegistryService } from '../package-registry';

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

describe('PackageRegistryService', () => {
  let registry: PackageRegistryService;

  beforeEach(() => {
    registry = new PackageRegistryService();
  });

  it('registers a built-in package and queries it back', () => {
    const manifest = makeManifest({ id: 'spreadsheet' });
    registry.registerBuiltInPackage(manifest, dummyLoader);

    const pkg = registry.getPackage('spreadsheet');
    expect(pkg).toBeDefined();
    expect(pkg!.packageId).toBe('spreadsheet');
    expect(pkg!.manifest.name).toBe('spreadsheet');
    expect(pkg!.state).toBe('installed');
    expect(pkg!.installationRecord.source).toBe('built-in');
  });

  it('registers a local-dev package', () => {
    const manifest = makeManifest({ id: 'dev-app' });
    registry.registerLocalDevPackage(manifest, dummyLoader);

    const pkg = registry.getPackage('dev-app');
    expect(pkg).toBeDefined();
    expect(pkg!.installationRecord.source).toBe('local-dev');
  });

  it('throws on duplicate package ID', () => {
    const manifest = makeManifest({ id: 'dup' });
    registry.registerBuiltInPackage(manifest, dummyLoader);

    expect(() => registry.registerBuiltInPackage(manifest, dummyLoader)).toThrow(
      "Package 'dup' is already registered",
    );
  });

  it('throws on invalid manifest (missing id)', () => {
    const manifest = { name: 'bad', version: '1.0.0', id: '' } as AppManifest;
    expect(() => registry.registerBuiltInPackage(manifest, dummyLoader)).toThrow(
      'Invalid manifest',
    );
  });

  it('throws on invalid manifest (missing name)', () => {
    const manifest = { id: 'ok', name: '', version: '1.0.0' } as AppManifest;
    expect(() => registry.registerBuiltInPackage(manifest, dummyLoader)).toThrow(
      'Invalid manifest',
    );
  });

  it('throws on invalid manifest (missing version)', () => {
    const manifest = { id: 'ok', name: 'ok', version: '' } as AppManifest;
    expect(() => registry.registerBuiltInPackage(manifest, dummyLoader)).toThrow(
      'Invalid manifest',
    );
  });

  it('throws on legacy-shaped app manifests', () => {
    const manifest = {
      id: 'spreadsheet',
      name: 'Spreadsheet',
      version: '1.0.0',
      capabilities: {
        required: ['spreadsheet:full'],
        optional: [],
      },
      firstParty: true,
    } as unknown as AppManifest;

    expect(() => registry.registerBuiltInPackage(manifest, dummyLoader)).toThrow(
      'Invalid manifest',
    );
  });

  it('enables and disables a package', () => {
    registry.registerBuiltInPackage(makeManifest({ id: 'a' }), dummyLoader);
    expect(registry.getPackageState('a')).toBe('installed');

    const result = registry.enablePackage('a');
    expect(result.success).toBe(true);
    expect(registry.getPackageState('a')).toBe('enabled');

    registry.disablePackage('a');
    expect(registry.getPackageState('a')).toBe('disabled');
  });

  it('enable returns failure for unknown package', () => {
    const result = registry.enablePackage('nonexistent');
    expect(result.success).toBe(false);
  });

  it('listPackages returns sorted entries', () => {
    registry.registerBuiltInPackage(makeManifest({ id: 'z-app' }), dummyLoader);
    registry.registerBuiltInPackage(makeManifest({ id: 'a-app' }), dummyLoader);
    registry.registerBuiltInPackage(makeManifest({ id: 'm-app' }), dummyLoader);

    const ids = registry.listPackages().map((p) => p.packageId);
    expect(ids).toEqual(['a-app', 'm-app', 'z-app']);
  });

  it('two registry instances do not share state (multi-shell isolation)', () => {
    const registryA = new PackageRegistryService();
    const registryB = new PackageRegistryService();

    registryA.registerBuiltInPackage(makeManifest({ id: 'only-in-a' }), dummyLoader);

    expect(registryA.getPackage('only-in-a')).toBeDefined();
    expect(registryB.getPackage('only-in-a')).toBeUndefined();
    expect(registryB.listPackages()).toHaveLength(0);
  });

  it('snapshot is deterministic', () => {
    registry.registerBuiltInPackage(makeManifest({ id: 'b' }), dummyLoader);
    registry.registerBuiltInPackage(makeManifest({ id: 'a' }), dummyLoader);

    const snap1 = registry.snapshot();
    const snap2 = registry.snapshot();

    // Entries should be in the same order
    expect(snap1.entries.map((e) => e.packageId)).toEqual(snap2.entries.map((e) => e.packageId));
    expect(snap1.entries.map((e) => e.packageId)).toEqual(['a', 'b']);
  });

  it('validateCompatibility returns valid for a well-formed manifest', () => {
    const result = registry.validateCompatibility(makeManifest({ id: 'good' }));
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
