/**
 * Capability Registry Service Tests
 */

import {
  CapabilityRegistryService,
  createCapabilityRegistryService,
  createEmptyCapabilityRegistryService,
  CORE_CAPABILITIES,
} from '../capability-registry';
import type { CapabilityRegistration } from '../capability-registry';

// =============================================================================
// Helpers
// =============================================================================

function makeRegistration(
  overrides: Partial<CapabilityRegistration> & { id: string },
): CapabilityRegistration {
  return {
    ownerPackage: '@test/pkg',
    name: overrides.id,
    description: `Test capability ${overrides.id}`,
    riskTier: 'low',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app'],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('CapabilityRegistryService', () => {
  describe('registration and lookup', () => {
    it('should register and retrieve a capability', () => {
      const registry = createEmptyCapabilityRegistryService();
      const cap = makeRegistration({ id: 'test:feature:read' });

      registry.register(cap);

      expect(registry.has('test:feature:read')).toBe(true);
      expect(registry.get('test:feature:read')).toMatchObject({ id: 'test:feature:read' });
    });

    it('should return undefined for unregistered capability', () => {
      const registry = createEmptyCapabilityRegistryService();
      expect(registry.get('nonexistent')).toBeUndefined();
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should list all registered capabilities', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:a:read' }));
      registry.register(makeRegistration({ id: 'test:b:write' }));

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.id).sort()).toEqual(['test:a:read', 'test:b:write']);
    });

    it('should throw when registering duplicate ID', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:dup:read' }));

      expect(() => {
        registry.register(makeRegistration({ id: 'test:dup:read' }));
      }).toThrow(/already registered/);
    });

    it('should freeze registered capabilities', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:frozen:read' }));
      const retrieved = registry.get('test:frozen:read')!;
      expect(Object.isFrozen(retrieved)).toBe(true);
    });
  });

  describe('batch registration', () => {
    it('should register multiple capabilities at once', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.registerBatch([
        makeRegistration({ id: 'test:batch:a' }),
        makeRegistration({ id: 'test:batch:b' }),
      ]);

      expect(registry.has('test:batch:a')).toBe(true);
      expect(registry.has('test:batch:b')).toBe(true);
    });

    it('should be atomic — no registrations on failure', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:exists:a' }));

      expect(() => {
        registry.registerBatch([
          makeRegistration({ id: 'test:new:b' }),
          makeRegistration({ id: 'test:exists:a' }), // duplicate
        ]);
      }).toThrow(/already registered/);

      // The first one should not have been registered
      expect(registry.has('test:new:b')).toBe(false);
    });
  });

  describe('namespace ownership', () => {
    it('should allow first registrant to own a namespace', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(
        makeRegistration({ id: 'vendor:feature:read', ownerPackage: '@vendor/pkg' }),
      );

      // Same package, same namespace — OK
      expect(() => {
        registry.register(
          makeRegistration({ id: 'vendor:feature:write', ownerPackage: '@vendor/pkg' }),
        );
      }).not.toThrow();
    });

    it('should reject different package registering in owned namespace', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(
        makeRegistration({ id: 'vendor:feature:read', ownerPackage: '@vendor/pkg-a' }),
      );

      expect(() => {
        registry.register(
          makeRegistration({ id: 'vendor:other:write', ownerPackage: '@vendor/pkg-b' }),
        );
      }).toThrow(/Namespace 'vendor' is owned by/);
    });

    it('should allow legacy two-part IDs without namespace enforcement', () => {
      const registry = createEmptyCapabilityRegistryService();
      // Legacy IDs like 'cells:read' have no namespace
      registry.register(makeRegistration({ id: 'cells:read', ownerPackage: '@pkg/a' }));
      registry.register(makeRegistration({ id: 'cells:write', ownerPackage: '@pkg/b' }));
      // Both succeed because two-part IDs have no namespace
      expect(registry.has('cells:read')).toBe(true);
      expect(registry.has('cells:write')).toBe(true);
    });

    it('should detect namespace conflicts within a batch', () => {
      const registry = createEmptyCapabilityRegistryService();
      expect(() => {
        registry.registerBatch([
          makeRegistration({ id: 'ns:a:read', ownerPackage: '@pkg/one' }),
          makeRegistration({ id: 'ns:b:read', ownerPackage: '@pkg/two' }),
        ]);
      }).toThrow(/Namespace 'ns' claimed by both/);
    });
  });

  describe('manifest validation', () => {
    it('should pass validation for known capabilities', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:cap:a' }));
      registry.register(makeRegistration({ id: 'test:cap:b' }));

      const result = registry.validateManifestCapabilities(['test:cap:a', 'test:cap:b']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for unknown capabilities', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:cap:a' }));

      const result = registry.validateManifestCapabilities(['test:cap:a', 'test:cap:unknown']);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].capabilityId).toBe('test:cap:unknown');
      expect(result.errors[0].message).toContain('Unknown capability');
    });

    it('should report multiple unknown capabilities', () => {
      const registry = createEmptyCapabilityRegistryService();
      const result = registry.validateManifestCapabilities(['a', 'b', 'c']);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('implied capability resolution', () => {
    it('should resolve direct implications', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:data:write', implies: ['test:data:read'] }));
      registry.register(makeRegistration({ id: 'test:data:read' }));

      const implied = registry.getImplied('test:data:write');
      expect(implied).toContain('test:data:read');
    });

    it('should resolve transitive implications', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:data:admin', implies: ['test:data:write'] }));
      registry.register(makeRegistration({ id: 'test:data:write', implies: ['test:data:read'] }));
      registry.register(makeRegistration({ id: 'test:data:read' }));

      const implied = registry.getImplied('test:data:admin');
      expect(implied).toContain('test:data:write');
      expect(implied).toContain('test:data:read');
    });

    it('should return empty array for capability with no implications', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:simple:read' }));

      const implied = registry.getImplied('test:simple:read');
      expect(implied).toHaveLength(0);
    });

    it('should return empty array for unknown capability', () => {
      const registry = createEmptyCapabilityRegistryService();
      const implied = registry.getImplied('nonexistent');
      expect(implied).toHaveLength(0);
    });

    it('should handle circular implications without infinite loop', () => {
      const registry = createEmptyCapabilityRegistryService();
      registry.register(makeRegistration({ id: 'test:a:x', implies: ['test:a:y'] }));
      registry.register(makeRegistration({ id: 'test:a:y', implies: ['test:a:x'] }));

      const implied = registry.getImplied('test:a:x');
      expect(implied).toContain('test:a:y');
      // Should not hang
    });
  });

  describe('core capabilities', () => {
    it('should pre-register core capabilities', () => {
      const registry = createCapabilityRegistryService();

      for (const cap of CORE_CAPABILITIES) {
        expect(registry.has(cap.id)).toBe(true);
      }
    });

    it('should include mog:network:unrestricted implying mog:network:fetch', () => {
      const registry = createCapabilityRegistryService();
      const implied = registry.getImplied('mog:network:unrestricted');
      expect(implied).toContain('mog:network:fetch');
    });
  });
});
