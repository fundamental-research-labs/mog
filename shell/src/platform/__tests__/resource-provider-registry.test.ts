import { createResourceProviderRegistry } from '../resource-provider-registry';
import type { ResourceProviderRegistration } from '../resource-provider-registry';

function makeRegistration(
  overrides?: Partial<ResourceProviderRegistration>,
): ResourceProviderRegistration {
  return {
    resourceKind: 'mog.test.widget',
    ownerPackageId: 'mog.test',
    supportedAccessModes: ['read', 'write'],
    ...overrides,
  };
}

describe('ResourceProviderRegistry', () => {
  it('registers a provider and retrieves it by kind', () => {
    const registry = createResourceProviderRegistry();
    const reg = makeRegistration();
    registry.registerProvider(reg);

    const found = registry.getProvider('mog.test.widget');
    expect(found).toBe(reg);
  });

  it('lists all registered providers', () => {
    const registry = createResourceProviderRegistry();
    registry.registerProvider(makeRegistration());
    registry.registerProvider(
      makeRegistration({
        resourceKind: 'mog.test.gadget',
      }),
    );

    expect(registry.listProviders()).toHaveLength(2);
  });

  it('rejects duplicate registration of the same kind', () => {
    const registry = createResourceProviderRegistry();
    registry.registerProvider(makeRegistration());

    expect(() => registry.registerProvider(makeRegistration())).toThrow(/already registered/);
  });

  it('allows re-registration after explicit unregister', () => {
    const registry = createResourceProviderRegistry();
    registry.registerProvider(makeRegistration());
    registry.unregisterProvider('mog.test.widget', 'mog.test');

    expect(registry.getProvider('mog.test.widget')).toBeUndefined();

    // Now re-register
    registry.registerProvider(makeRegistration());
    expect(registry.getProvider('mog.test.widget')).toBeDefined();
  });

  it('prevents unregister by a non-owner package', () => {
    const registry = createResourceProviderRegistry();
    registry.registerProvider(makeRegistration());

    expect(() => registry.unregisterProvider('mog.test.widget', 'mog.other')).toThrow(
      /cannot unregister/i,
    );
  });

  it('reserved kinds can only be registered by core', () => {
    const registry = createResourceProviderRegistry();

    expect(() =>
      registry.registerProvider(
        makeRegistration({
          resourceKind: 'mog.resource.workspace',
          ownerPackageId: 'mog.test',
        }),
      ),
    ).toThrow(/reserved for core/);

    // Core can register reserved kinds
    registry.registerProvider({
      resourceKind: 'mog.resource.workspace',
      ownerPackageId: 'mog.core',
      supportedAccessModes: ['readwrite'],
    });
    expect(registry.getProvider('mog.resource.workspace')).toBeDefined();
  });

  it('returns undefined for missing provider (fail closed)', () => {
    const registry = createResourceProviderRegistry();
    expect(registry.getProvider('nonexistent.kind')).toBeUndefined();
  });

  it('validates namespace ownership', () => {
    const registry = createResourceProviderRegistry();

    // Package "mog.test" cannot register "mog.other.thing"
    expect(() =>
      registry.registerProvider(
        makeRegistration({
          resourceKind: 'mog.other.thing',
          ownerPackageId: 'mog.test',
        }),
      ),
    ).toThrow(/namespace mismatch/);
  });

  it('core package bypasses namespace validation', () => {
    const registry = createResourceProviderRegistry();

    // Core can register anything
    registry.registerProvider({
      resourceKind: 'mog.anything.here',
      ownerPackageId: 'mog.core',
      supportedAccessModes: ['read'],
    });
    expect(registry.getProvider('mog.anything.here')).toBeDefined();
  });

  describe('resolveRoute', () => {
    it('resolves a matching route to the provider and resource ref', () => {
      const registry = createResourceProviderRegistry();
      registry.registerProvider(
        makeRegistration({
          routePattern: '/widget/:id',
        }),
      );

      const result = registry.resolveRoute('/widget/abc123');
      expect(result).toBeDefined();
      expect(result!.provider.resourceKind).toBe('mog.test.widget');
      expect(result!.resourceRef.kind).toBe('mog.test.widget');
      expect(result!.resourceRef.id).toBe('abc123');
    });

    it('returns undefined for non-matching route', () => {
      const registry = createResourceProviderRegistry();
      registry.registerProvider(
        makeRegistration({
          routePattern: '/widget/:id',
        }),
      );

      expect(registry.resolveRoute('/other/path')).toBeUndefined();
    });

    it('returns undefined when no providers have route patterns', () => {
      const registry = createResourceProviderRegistry();
      registry.registerProvider(makeRegistration());

      expect(registry.resolveRoute('/any/path')).toBeUndefined();
    });
  });
});
