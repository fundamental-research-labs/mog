/**
 * Trust Policy Service Tests
 */

import {
  createTrustPolicyService,
  DEFAULT_FIRST_PARTY_PACKAGES,
  TrustPolicyService,
} from '../trust-policy';
import type { PackageInstallRecord, TrustPolicyServiceOptions } from '../trust-policy';

// =============================================================================
// Helpers
// =============================================================================

function createDefaultOptions(): TrustPolicyServiceOptions {
  return {
    bundledFirstPartyPackages: DEFAULT_FIRST_PARTY_PACKAGES,
    restrictedCapabilities: new Set(['mog:dangerous:op']),
    localDevAutoGrantCapabilities: new Set(['mog:ui:panel', 'mog:storage:local']),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('TrustPolicyService', () => {
  describe('bundled first-party packages', () => {
    it('should identify first-party packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      expect(service.isTrustedFirstParty('spreadsheet')).toBe(true);
      expect(service.isTrustedFirstParty('crm')).toBe(true);
      expect(service.isTrustedFirstParty('unknown-pkg')).toBe(false);
    });

    it('should auto-trust bundled first-party packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({ packageId: 'spreadsheet', bundled: true });

      expect(decision.canInstall).toBe(true);
      expect(decision.canEnable).toBe(true);
      expect(decision.trustSource).toBe('bundled-first-party');
      expect(decision.denyList).toHaveLength(0);
    });

    it('should auto-grant all capabilities for first-party packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      expect(service.canAutoGrant('spreadsheet', 'mog:cells:read')).toBe(true);
      expect(service.canAutoGrant('spreadsheet', 'mog:network:unrestricted')).toBe(true);
    });

    it('should respect firstPartyAutoGrantCapabilities when set', () => {
      const service = createTrustPolicyService({
        bundledFirstPartyPackages: new Set(['my-app']),
        firstPartyAutoGrantCapabilities: new Set(['mog:ui:panel']),
      });

      expect(service.canAutoGrant('my-app', 'mog:ui:panel')).toBe(true);
      expect(service.canAutoGrant('my-app', 'mog:network:fetch')).toBe(false);
    });
  });

  describe('signed marketplace packages', () => {
    it('should allow installation with consent required', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({
        packageId: 'marketplace-pkg',
        signature: 'valid-signature-abc',
      });

      expect(decision.canInstall).toBe(true);
      expect(decision.canEnable).toBe(true);
      expect(decision.trustSource).toBe('signed-marketplace');
      expect(decision.denyList).toContain('mog:dangerous:op');
    });

    it('should not auto-grant capabilities for marketplace packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      // First evaluate trust to create the trust record
      service.evaluateTrust({
        packageId: 'marketplace-pkg',
        signature: 'valid-signature',
      });

      expect(service.canAutoGrant('marketplace-pkg', 'mog:ui:panel')).toBe(false);
    });
  });

  describe('local-dev packages', () => {
    it('should allow installation for local-dev packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({
        packageId: 'my-local-plugin',
        localDev: true,
      });

      expect(decision.canInstall).toBe(true);
      expect(decision.canEnable).toBe(true);
      expect(decision.trustSource).toBe('local-dev');
    });

    it('should auto-grant dev capabilities for local-dev packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      service.evaluateTrust({ packageId: 'my-local', localDev: true });

      expect(service.canAutoGrant('my-local', 'mog:ui:panel')).toBe(true);
      expect(service.canAutoGrant('my-local', 'mog:storage:local')).toBe(true);
    });

    it('should not auto-grant non-dev capabilities for local-dev packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      service.evaluateTrust({ packageId: 'my-local', localDev: true });

      expect(service.canAutoGrant('my-local', 'mog:network:unrestricted')).toBe(false);
    });

    it('should deny restricted capabilities for local-dev packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({
        packageId: 'my-local',
        localDev: true,
      });

      expect(decision.denyList).toContain('mog:dangerous:op');
    });
  });

  describe('enterprise policy packages', () => {
    it('should allow enterprise-policy packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({
        packageId: 'enterprise-tool',
        enterprisePolicyId: 'policy-123',
      });

      expect(decision.canInstall).toBe(true);
      expect(decision.canEnable).toBe(true);
      expect(decision.trustSource).toBe('enterprise-policy');
    });
  });

  describe('unknown source packages', () => {
    it('should reject packages with no trust source', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      const decision = service.evaluateTrust({
        packageId: 'random-package',
      });

      expect(decision.canInstall).toBe(false);
      expect(decision.canEnable).toBe(false);
      expect(decision.trustSource).toBeUndefined();
    });

    it('should not auto-grant for unknown packages', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      expect(service.canAutoGrant('random-package', 'mog:ui:panel')).toBe(false);
    });
  });

  describe('trust source priority', () => {
    it('should prefer bundled first-party over other sources', () => {
      const service = createTrustPolicyService(createDefaultOptions());
      // Package is both bundled and has a signature
      const decision = service.evaluateTrust({
        packageId: 'spreadsheet',
        bundled: true,
        signature: 'some-signature',
      });

      expect(decision.trustSource).toBe('bundled-first-party');
    });
  });
});
