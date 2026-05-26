/**
 * Grant Service Tests
 */

import { createCapabilitySubject } from '../capability-subject';
import { CapabilityGrantService, createCapabilityGrantService } from '../grant-service';
import { createEmptyCapabilityRegistryService } from '../capability-registry';
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

describe('CapabilityGrantService', () => {
  describe('grant/revoke/check cycle', () => {
    it('should grant and check a capability', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'user-consented');

      const result = service.check(subject, 'test:cap');
      expect(result.granted).toBe(true);
      expect(result.decision).toBe('user-consented');
    });

    it('should revoke a capability', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'user-consented');
      const revoked = service.revoke(subject, 'test:cap');

      expect(revoked).toBe(true);
      expect(service.check(subject, 'test:cap').granted).toBe(false);
    });

    it('should return false when revoking non-existent grant', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });
      expect(service.revoke(subject, 'test:cap')).toBe(false);
    });

    it('should replace existing grant on re-grant', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'user-consented');
      service.grant(subject, 'test:cap', { filter: 'new' }, 'admin-approved');

      const result = service.check(subject, 'test:cap');
      expect(result.granted).toBe(true);
      expect(result.decision).toBe('admin-approved');
      expect(result.scope).toEqual({ filter: 'new' });
    });
  });

  describe('subject-scoped grants', () => {
    it('should match broader grant for narrower query', () => {
      const service = createCapabilityGrantService();
      const grantSubject = createCapabilitySubject({ appId: 'foo' });
      const querySubject = createCapabilitySubject({ appId: 'foo', instanceId: '123' });

      service.grant(grantSubject, 'test:cap', undefined, 'auto-granted');

      const result = service.check(querySubject, 'test:cap');
      expect(result.granted).toBe(true);
    });

    it('should NOT match instance-level grant for different instance', () => {
      const service = createCapabilityGrantService();
      const grantSubject = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
      const querySubject = createCapabilitySubject({ appId: 'foo', instanceId: '456' });

      service.grant(grantSubject, 'test:cap', undefined, 'user-consented');

      const result = service.check(querySubject, 'test:cap');
      expect(result.granted).toBe(false);
    });

    it('should NOT match instance-level grant for app-level query (missing field)', () => {
      const service = createCapabilityGrantService();
      const grantSubject = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
      const querySubject = createCapabilitySubject({ appId: 'foo' });

      service.grant(grantSubject, 'test:cap', undefined, 'user-consented');

      // Grant requires instanceId='123' but query has no instanceId
      const result = service.check(querySubject, 'test:cap');
      expect(result.granted).toBe(false);
    });

    it('should isolate grants between different apps', () => {
      const service = createCapabilityGrantService();
      const subjectA = createCapabilitySubject({ appId: 'app-a' });
      const subjectB = createCapabilitySubject({ appId: 'app-b' });

      service.grant(subjectA, 'test:cap', undefined, 'user-consented');

      expect(service.check(subjectA, 'test:cap').granted).toBe(true);
      expect(service.check(subjectB, 'test:cap').granted).toBe(false);
    });
  });

  describe('expiration', () => {
    it('should reject expired grants', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      // Grant with past expiration
      service.grant(subject, 'test:cap', undefined, 'user-consented', Date.now() - 1000);

      const result = service.check(subject, 'test:cap');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should accept non-expired grants', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'user-consented', Date.now() + 60000);

      expect(service.check(subject, 'test:cap').granted).toBe(true);
    });
  });

  describe('denied and revoked decisions', () => {
    it('should not grant denied decisions', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'denied');

      const result = service.check(subject, 'test:cap');
      expect(result.granted).toBe(false);
      expect(result.decision).toBe('denied');
    });

    it('should not grant revoked decisions', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:cap', undefined, 'revoked');

      const result = service.check(subject, 'test:cap');
      expect(result.granted).toBe(false);
      expect(result.decision).toBe('revoked');
    });
  });

  describe('listGrants', () => {
    it('should list active grants for a subject', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:a', undefined, 'user-consented');
      service.grant(subject, 'test:b', undefined, 'auto-granted');

      const grants = service.listGrants(subject);
      expect(grants).toHaveLength(2);
      expect(grants.map((g) => g.capabilityId).sort()).toEqual(['test:a', 'test:b']);
    });

    it('should exclude expired grants from listing', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:active', undefined, 'user-consented');
      service.grant(subject, 'test:expired', undefined, 'user-consented', Date.now() - 1000);

      const grants = service.listGrants(subject);
      expect(grants).toHaveLength(1);
      expect(grants[0].capabilityId).toBe('test:active');
    });

    it('should exclude denied grants from listing', () => {
      const service = createCapabilityGrantService();
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:active', undefined, 'user-consented');
      service.grant(subject, 'test:denied', undefined, 'denied');

      const grants = service.listGrants(subject);
      expect(grants).toHaveLength(1);
    });

    it('should include broader grants when querying with narrower subject', () => {
      const service = createCapabilityGrantService();
      const broad = createCapabilitySubject({ appId: 'foo' });
      const narrow = createCapabilitySubject({ appId: 'foo', instanceId: '123' });

      service.grant(broad, 'test:cap', undefined, 'user-consented');

      const grants = service.listGrants(narrow);
      expect(grants).toHaveLength(1);
    });
  });

  describe('listGrantsForCapability', () => {
    it('should list all grants for a specific capability across subjects', () => {
      const service = createCapabilityGrantService();
      const subjectA = createCapabilitySubject({ appId: 'app-a' });
      const subjectB = createCapabilitySubject({ appId: 'app-b' });

      service.grant(subjectA, 'shared:cap', undefined, 'user-consented');
      service.grant(subjectB, 'shared:cap', undefined, 'auto-granted');
      service.grant(subjectA, 'other:cap', undefined, 'user-consented');

      const grants = service.listGrantsForCapability('shared:cap');
      expect(grants).toHaveLength(2);
    });
  });

  describe('implied capabilities via registry', () => {
    it('should check implied capabilities through registry', () => {
      const registryService = createEmptyCapabilityRegistryService();
      registryService.register(
        makeRegistration({ id: 'test:data:write', implies: ['test:data:read'] }),
      );
      registryService.register(makeRegistration({ id: 'test:data:read' }));

      const service = createCapabilityGrantService({ registryService });
      const subject = createCapabilitySubject({ appId: 'foo' });

      // Grant write, which implies read
      service.grant(subject, 'test:data:write', undefined, 'user-consented');

      // Check read — should be granted via implication
      const result = service.check(subject, 'test:data:read');
      expect(result.granted).toBe(true);
      expect(result.reason).toContain('Implied by');
    });

    it('should not grant non-implied capabilities', () => {
      const registryService = createEmptyCapabilityRegistryService();
      registryService.register(
        makeRegistration({ id: 'test:data:write', implies: ['test:data:read'] }),
      );
      registryService.register(makeRegistration({ id: 'test:data:read' }));
      registryService.register(makeRegistration({ id: 'test:data:admin' }));

      const service = createCapabilityGrantService({ registryService });
      const subject = createCapabilitySubject({ appId: 'foo' });

      service.grant(subject, 'test:data:write', undefined, 'user-consented');

      // Admin is not implied by write
      expect(service.check(subject, 'test:data:admin').granted).toBe(false);
    });
  });
});
