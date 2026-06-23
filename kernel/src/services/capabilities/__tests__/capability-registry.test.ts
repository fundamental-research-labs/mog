/**
 * Capability Registry Tests
 *
 * Comprehensive tests for the capability registry and grant stores.
 *
 */

import { jest } from '@jest/globals';

import { appId } from '../grants';
import { createScope } from '../scope';

import { CapabilityRegistry } from '../registry';
import {
  CAPABILITY_REGISTRY,
  CloudGrantsStore,
  capabilityImplies,
  compareVectorClocks,
  createCloudGrantsStore,
  createMemoryGrantsStore,
  getCapabilityInfo,
  incrementVectorClock,
  MemoryGrantsStore,
  mergeVectorClocks,
  type CloudGrant,
} from '../index';

describe('CapabilityRegistry', () => {
  let store: MemoryGrantsStore;
  let registry: CapabilityRegistry;
  const testAppId = appId('test-app');

  beforeEach(() => {
    store = createMemoryGrantsStore();
    registry = new CapabilityRegistry(store);
  });

  // ===========================================================================
  // Basic Grant/Revoke Operations
  // ===========================================================================

  describe('grant/revoke basic operations', () => {
    it('should grant a capability', () => {
      registry.grant(testAppId, 'cells:read');

      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
    });

    it('should revoke a capability', () => {
      registry.grant(testAppId, 'cells:read');
      registry.revoke(testAppId, 'cells:read');

      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(false);
    });

    it('should revoke all capabilities', () => {
      registry.grant(testAppId, 'cells:read');
      registry.grant(testAppId, 'tables:read');
      registry.grant(testAppId, 'sheets:read');

      const count = registry.revokeAll(testAppId);

      expect(count).toBe(3);
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(false);
      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(false);
      expect(registry.hasCapability(testAppId, 'sheets:read')).toBe(false);
    });

    it('should return false for non-existent capability', () => {
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(false);
    });

    it('should handle granting same capability twice', () => {
      registry.grant(testAppId, 'cells:read');
      registry.grant(testAppId, 'cells:read');

      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
      expect(registry.getGrants(testAppId).length).toBe(1);
    });
  });

  // ===========================================================================
  // Dependency Expansion (Grant with Dependencies)
  // ===========================================================================

  describe('dependency expansion', () => {
    it('should auto-grant dependencies (cells:write -> cells:read)', () => {
      registry.grant(testAppId, 'cells:write');

      expect(registry.hasCapability(testAppId, 'cells:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
    });

    it('should auto-grant dependencies (tables:write -> tables:read)', () => {
      registry.grant(testAppId, 'tables:write');

      expect(registry.hasCapability(testAppId, 'tables:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);
    });

    it('should auto-grant transitive dependencies (tables:writeAll)', () => {
      registry.grant(testAppId, 'tables:writeAll');

      // tables:writeAll -> [tables:write, tables:readAll]
      // tables:write -> [tables:read]
      // tables:readAll -> [tables:read]
      expect(registry.hasCapability(testAppId, 'tables:writeAll')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:readAll')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);
    });

    it('should auto-grant network hierarchy (network:any)', () => {
      registry.grant(testAppId, 'network:any');

      // network:any -> [network:allowlist, network:sameorigin]
      expect(registry.hasCapability(testAppId, 'network:any')).toBe(true);
      expect(registry.hasCapability(testAppId, 'network:allowlist')).toBe(true);
      expect(registry.hasCapability(testAppId, 'network:sameorigin')).toBe(true);
      // network:localhost is separate
      expect(registry.hasCapability(testAppId, 'network:localhost')).toBe(false);
    });

    it('should expand capabilities correctly', () => {
      const expanded = registry.expandCapabilities(['cells:write']);

      expect(expanded).toContain('cells:write');
      expect(expanded).toContain('cells:read');
    });

    it('should not auto-grant version-control dependencies', () => {
      registry.grant(testAppId, 'version:mergeApply');

      expect(registry.hasCapability(testAppId, 'version:mergeApply')).toBe(true);
      expect(registry.hasCapability(testAppId, 'version:mergePreview')).toBe(false);
      expect(registry.hasCapability(testAppId, 'version:diff')).toBe(false);
      expect(registry.hasCapability(testAppId, 'version:read')).toBe(false);
      expect(registry.hasCapability(testAppId, 'version:commit')).toBe(false);

      const expanded = registry.expandCapabilities([
        'version:mergePreview',
        'version:mergeApply',
        'version:branch',
      ]);
      expect(expanded).toEqual(['version:mergePreview', 'version:mergeApply', 'version:branch']);
    });

    it('should expose VC-08 version capabilities with plan-aligned tier and risk', () => {
      const versionCapabilities = [
        'version:read',
        'version:diff',
        'version:commit',
        'version:branch',
        'version:checkout',
        'version:reviewRead',
        'version:reviewWrite',
        'version:proposal',
        'version:mergePreview',
        'version:mergeApply',
        'version:revert',
        'version:provenance',
        'version:remotePromote',
      ] as const;

      for (const capability of versionCapabilities) {
        expect(CAPABILITY_REGISTRY).toHaveProperty(capability);
        expect(getCapabilityInfo(capability).tier).toBe(2);
      }
      expect(getCapabilityInfo('version:read').riskLevel).toBe('medium');
      expect(getCapabilityInfo('version:diff').riskLevel).toBe('medium');
      expect(getCapabilityInfo('version:reviewRead').riskLevel).toBe('medium');
      expect(getCapabilityInfo('version:provenance').riskLevel).toBe('medium');
      expect(getCapabilityInfo('version:commit').riskLevel).toBe('high');
      expect(getCapabilityInfo('version:checkout').riskLevel).toBe('high');
      expect(getCapabilityInfo('version:mergeApply').riskLevel).toBe('high');
      expect(getCapabilityInfo('version:remotePromote').riskLevel).toBe('high');

      expect(capabilityImplies('version:proposal', 'version:reviewRead')).toBe(false);
      expect(capabilityImplies('version:checkout', 'version:read')).toBe(false);
      expect(capabilityImplies('version:mergeApply', 'version:diff')).toBe(false);
    });
  });

  // ===========================================================================
  // Revoke Cascades (Revoke Dependencies)
  // ===========================================================================

  describe('revoke cascades', () => {
    it('should cascade revoke (revoke cells:read -> revoke cells:write)', () => {
      // Grant write (which grants read)
      registry.grant(testAppId, 'cells:write');
      expect(registry.hasCapability(testAppId, 'cells:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);

      // Revoke read should also revoke write
      registry.revoke(testAppId, 'cells:read');

      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(false);
      expect(registry.hasCapability(testAppId, 'cells:write')).toBe(false);
    });

    it('should cascade revoke (revoke tables:read -> revoke tables:write, tables:create, etc.)', () => {
      registry.grant(testAppId, 'tables:write');
      registry.grant(testAppId, 'tables:create');
      registry.grant(testAppId, 'tables:delete');

      registry.revoke(testAppId, 'tables:read');

      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(false);
      expect(registry.hasCapability(testAppId, 'tables:write')).toBe(false);
      expect(registry.hasCapability(testAppId, 'tables:create')).toBe(false);
      expect(registry.hasCapability(testAppId, 'tables:delete')).toBe(false);
    });

    it('should not cascade revoke to unrelated capabilities', () => {
      registry.grant(testAppId, 'cells:write');
      registry.grant(testAppId, 'tables:write');

      // Revoke cells should not affect tables
      registry.revoke(testAppId, 'cells:read');

      expect(registry.hasCapability(testAppId, 'tables:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);
    });
  });

  // ===========================================================================
  // Implied Capabilities (Has via Implication)
  // ===========================================================================

  describe('implied capabilities', () => {
    it('should recognize implied capability (has write -> has read)', () => {
      // Grant only write (which auto-grants read as well)
      registry.grant(testAppId, 'cells:write');

      // Should have read via implication
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
    });

    it('should get effective capabilities including implied', () => {
      registry.grant(testAppId, 'cells:write');

      const effective = registry.getEffectiveCapabilities(testAppId);

      expect(effective).toContain('cells:write');
      expect(effective).toContain('cells:read');
    });
  });

  // ===========================================================================
  // Scope Enforcement
  // ===========================================================================

  describe('scope enforcement', () => {
    it('should enforce scope matching', () => {
      registry.grant(testAppId, 'tables:read', {
        scope: createScope('table:contacts'),
      });

      // Should have access to contacts
      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'contacts',
        }),
      ).toBe(true);

      // Should NOT have access to orders
      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'orders',
        }),
      ).toBe(false);
    });

    it('should support wildcard scopes', () => {
      registry.grant(testAppId, 'tables:read', {
        scope: createScope('table:sales_*'),
      });

      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'sales_q1',
        }),
      ).toBe(true);

      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'sales_q2',
        }),
      ).toBe(true);

      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'marketing_q1',
        }),
      ).toBe(false);
    });

    it('should allow unscoped access when no scope in grant', () => {
      registry.grant(testAppId, 'tables:read');

      // Unscoped grant should allow access to any table
      expect(
        registry.hasCapability(testAppId, 'tables:read', {
          resourceType: 'table',
          resourceId: 'anything',
        }),
      ).toBe(true);
    });

    it('should track scoped capabilities', () => {
      registry.grant(testAppId, 'tables:read', {
        scope: createScope('table:contacts'),
      });

      expect(registry.isCapabilityScoped(testAppId, 'tables:read')).toBe(true);
      expect(registry.getCapabilityScope(testAppId, 'tables:read')).toBe('table:contacts');
    });
  });

  // ===========================================================================
  // Session Expiry
  // ===========================================================================

  describe('session expiry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should respect expiration time', () => {
      const expiresAt = Date.now() + 1000; // 1 second from now
      registry.grant(testAppId, 'credentials:use', {
        sessionOnly: true,
        expiresAt,
      });

      expect(registry.hasCapability(testAppId, 'credentials:use')).toBe(true);

      // Advance time past expiration
      jest.advanceTimersByTime(2000);

      expect(registry.hasCapability(testAppId, 'credentials:use')).toBe(false);
    });

    it('should support duration-based expiration', () => {
      registry.grant(testAppId, 'credentials:use', {
        sessionOnly: true,
        duration: 1000, // 1 second
      });

      expect(registry.hasCapability(testAppId, 'credentials:use')).toBe(true);

      // Advance time past duration
      jest.advanceTimersByTime(2000);

      expect(registry.hasCapability(testAppId, 'credentials:use')).toBe(false);
    });

    it('should cleanup expired grants', () => {
      registry.grant(testAppId, 'credentials:use', {
        sessionOnly: true,
        expiresAt: Date.now() + 1000,
      });
      registry.grant(testAppId, 'cells:read'); // No expiration

      jest.advanceTimersByTime(2000);

      const count = registry.cleanupExpired();

      expect(count).toBe(1);
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
    });
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  describe('events', () => {
    it('should emit capability:granted event', () => {
      const handler = jest.fn();
      registry.on('capability:granted', handler);

      registry.grant(testAppId, 'cells:read');

      // Should be called for cells:read (direct grant)
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'capability:granted',
        appId: testAppId,
        capability: 'cells:read',
      });
    });

    it('should emit capability:revoked event', () => {
      const handler = jest.fn();
      registry.grant(testAppId, 'cells:read');

      registry.on('capability:revoked', handler);
      registry.revoke(testAppId, 'cells:read');

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'capability:revoked',
        appId: testAppId,
        capability: 'cells:read',
      });
    });

    it('should allow unsubscribing', () => {
      const handler = jest.fn();
      const subscription = registry.on('capability:granted', handler);

      subscription.dispose();
      registry.grant(testAppId, 'cells:read');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  describe('batch operations', () => {
    it('should grant multiple capabilities with dependencies', () => {
      registry.grantBatch(testAppId, ['cells:write', 'tables:write']);

      expect(registry.hasCapability(testAppId, 'cells:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:write')).toBe(true);
      expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);
    });
  });
});

// =============================================================================
// Memory Store Tests
// =============================================================================

describe('MemoryGrantsStore', () => {
  let store: MemoryGrantsStore;
  const testAppId = appId('test-app');

  beforeEach(() => {
    store = createMemoryGrantsStore();
  });

  describe('grant/revoke', () => {
    it('should store and retrieve grants', () => {
      store.grant(testAppId, 'cells:read');

      expect(store.hasGrant(testAppId, 'cells:read')).toBe(true);
      expect(store.getGrant(testAppId, 'cells:read')).toBeDefined();
    });

    it('should revoke grants', () => {
      store.grant(testAppId, 'cells:read');
      const revoked = store.revoke(testAppId, 'cells:read');

      expect(revoked).toBe(true);
      expect(store.hasGrant(testAppId, 'cells:read')).toBe(false);
    });

    it('should return false when revoking non-existent grant', () => {
      const revoked = store.revoke(testAppId, 'cells:read');
      expect(revoked).toBe(false);
    });
  });

  describe('denials', () => {
    it('should track denials', () => {
      store.deny(testAppId, 'network:any', 'User denied');

      expect(store.isDenied(testAppId, 'network:any')).toBe(true);
      expect(store.getDenial(testAppId, 'network:any')?.reason).toBe('User denied');
    });

    it('should clear denials on grant', () => {
      store.deny(testAppId, 'cells:read');
      store.grant(testAppId, 'cells:read');

      expect(store.isDenied(testAppId, 'cells:read')).toBe(false);
    });
  });

  describe('subscriptions', () => {
    it('should notify app subscribers', () => {
      const callback = jest.fn();
      store.subscribe(testAppId, callback);

      store.grant(testAppId, 'cells:read');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'granted',
          appId: testAppId,
          capability: 'cells:read',
        }),
      );
    });

    it('should notify global subscribers', () => {
      const callback = jest.fn();
      store.subscribeAll(callback);

      store.grant(testAppId, 'cells:read');

      expect(callback).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Cloud Store Tests
// =============================================================================

describe('CloudGrantsStore', () => {
  let store: CloudGrantsStore;
  const testAppId = appId('test-app');

  beforeEach(() => {
    store = createCloudGrantsStore({ nodeId: 'node-1' });
  });

  afterEach(() => {
    store.dispose();
  });

  describe('basic operations', () => {
    it('should grant and check capabilities', () => {
      store.grant(testAppId, 'cells:read');

      expect(store.hasGrant(testAppId, 'cells:read')).toBe(true);
    });

    it('should revoke capabilities (creates tombstone)', () => {
      store.grant(testAppId, 'cells:read');
      store.revoke(testAppId, 'cells:read');

      expect(store.hasGrant(testAppId, 'cells:read')).toBe(false);
    });
  });

  describe('conflict resolution - revocations win', () => {
    it('should let revocations win over concurrent grants', async () => {
      // Simulate two nodes
      const node1 = createCloudGrantsStore({ nodeId: 'node-1' });
      const node2 = createCloudGrantsStore({ nodeId: 'node-2' });

      // Node 1 grants
      node1.grant(testAppId, 'cells:read');

      // Node 2 revokes (concurrent)
      node2.grant(testAppId, 'cells:read');
      node2.revoke(testAppId, 'cells:read');

      // Simulate sync: node2's grants (including tombstone) to node1
      const node2Grants = node2.getAllGrantsIncludingTombstones() as CloudGrant[];

      // Create a sync function that returns node2's state
      const node1WithSync = createCloudGrantsStore({
        nodeId: 'node-1',
        syncFn: async () => node2Grants,
      });

      // Copy node1's state
      node1WithSync.grant(testAppId, 'cells:read');

      // Sync
      await node1WithSync.sync();

      // Revocation should win (fail-secure)
      expect(node1WithSync.hasGrant(testAppId, 'cells:read')).toBe(false);

      node1.dispose();
      node2.dispose();
      node1WithSync.dispose();
    });
  });
});

// =============================================================================
// Vector Clock Tests
// =============================================================================

describe('Vector Clock Utilities', () => {
  describe('compareVectorClocks', () => {
    it('should detect equal clocks', () => {
      const a = { node1: 1, node2: 2 };
      const b = { node1: 1, node2: 2 };

      expect(compareVectorClocks(a, b)).toBe('equal');
    });

    it('should detect before relationship', () => {
      const a = { node1: 1, node2: 1 };
      const b = { node1: 2, node2: 2 };

      expect(compareVectorClocks(a, b)).toBe('before');
    });

    it('should detect after relationship', () => {
      const a = { node1: 2, node2: 2 };
      const b = { node1: 1, node2: 1 };

      expect(compareVectorClocks(a, b)).toBe('after');
    });

    it('should detect concurrent clocks', () => {
      const a = { node1: 2, node2: 1 };
      const b = { node1: 1, node2: 2 };

      expect(compareVectorClocks(a, b)).toBe('concurrent');
    });

    it('should handle missing keys', () => {
      const a = { node1: 1 };
      const b = { node1: 1, node2: 1 };

      expect(compareVectorClocks(a, b)).toBe('before');
    });
  });

  describe('mergeVectorClocks', () => {
    it('should take max of each component', () => {
      const a = { node1: 2, node2: 1 };
      const b = { node1: 1, node2: 3, node3: 1 };

      const merged = mergeVectorClocks(a, b);

      expect(merged).toEqual({ node1: 2, node2: 3, node3: 1 });
    });
  });

  describe('incrementVectorClock', () => {
    it('should increment the specified node', () => {
      const clock = { node1: 1, node2: 2 };
      const incremented = incrementVectorClock(clock, 'node1');

      expect(incremented).toEqual({ node1: 2, node2: 2 });
    });

    it('should add new node with value 1', () => {
      const clock = { node1: 1 };
      const incremented = incrementVectorClock(clock, 'node2');

      expect(incremented).toEqual({ node1: 1, node2: 1 });
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration Tests', () => {
  let store: MemoryGrantsStore;
  let registry: CapabilityRegistry;

  beforeEach(() => {
    store = createMemoryGrantsStore();
    registry = new CapabilityRegistry(store);
  });

  describe('multi-app isolation', () => {
    const app1 = appId('app-1');
    const app2 = appId('app-2');

    it('should isolate capabilities between apps', () => {
      registry.grant(app1, 'cells:write');
      registry.grant(app2, 'tables:read');

      expect(registry.hasCapability(app1, 'cells:write')).toBe(true);
      expect(registry.hasCapability(app1, 'tables:read')).toBe(false);

      expect(registry.hasCapability(app2, 'cells:write')).toBe(false);
      expect(registry.hasCapability(app2, 'tables:read')).toBe(true);
    });

    it('should not affect other apps on revoke', () => {
      registry.grant(app1, 'cells:write');
      registry.grant(app2, 'cells:write');

      registry.revokeAll(app1);

      expect(registry.hasCapability(app1, 'cells:write')).toBe(false);
      expect(registry.hasCapability(app2, 'cells:write')).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    const testApp = appId('complex-app');

    it('should handle grant/revoke/re-grant cycle', () => {
      // Grant
      registry.grant(testApp, 'cells:write');
      expect(registry.hasCapability(testApp, 'cells:write')).toBe(true);

      // Revoke
      registry.revoke(testApp, 'cells:write');
      expect(registry.hasCapability(testApp, 'cells:write')).toBe(false);

      // Re-grant
      registry.grant(testApp, 'cells:write');
      expect(registry.hasCapability(testApp, 'cells:write')).toBe(true);
    });

    it('should handle partial revoke of dependencies', () => {
      // Grant cells:write (grants both write and read)
      registry.grant(testApp, 'cells:write');

      // Revoke just write (should keep read)
      registry.revoke(testApp, 'cells:write');

      // Should still have read
      expect(registry.hasCapability(testApp, 'cells:read')).toBe(true);
      expect(registry.hasCapability(testApp, 'cells:write')).toBe(false);
    });
  });
});
