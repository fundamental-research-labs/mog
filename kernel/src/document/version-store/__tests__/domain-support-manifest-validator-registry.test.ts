import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import type { DomainCapabilityPolicyManifest } from '@mog-sdk/contracts/versioning';
import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { NOW, registryManifest } from './domain-support-manifest-validator-fixtures';

describe('validateDomainSupportManifest public registry policy', () => {
  it('accepts first-slice rows that match the public domain policy registry', () => {
    const result = validateDomainSupportManifest(registryManifest(), {
      now: NOW,
      operation: 'checkout',
      domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed when a manifest references an unknown public domain policy id', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      domainPolicyId: 'cells.values.unregistered',
    } as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'unknown-domain-policy')).toMatchObject({
        matrixRowId: 'cells.values',
        domainId: 'cells.values',
        policyField: 'domainPolicyId',
        policyValue: 'cells.values.unregistered',
      });
    }
  });

  it('fails closed when a manifest row drifts from the public registry policy', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      capabilityStates: {
        ...cells.capabilityStates,
        capture: 'contracted',
      },
    } as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.find((d) => d.code === 'domain-policy-registry-mismatch'),
      ).toMatchObject({
        matrixRowId: 'cells.values',
        domainId: 'cells.values',
        policyField: 'capabilityStates.capture',
        policyValue: 'contracted',
      });
    }
  });

  it('does not echo eval-only expected-failing capability states in diagnostics', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      capabilityStates: {
        ...cells.capabilityStates,
        capture: 'expected-failing',
      },
    } as unknown as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        operation: 'commit',
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('expected-failing');
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining(['unknown-capability-state', 'domain-policy-registry-mismatch']),
      );
      expect(
        result.diagnostics.find(
          (d) =>
            d.code === 'domain-policy-registry-mismatch' &&
            d.policyField === 'capabilityStates.capture',
        ),
      ).not.toHaveProperty('policyValue');
    }
  });
});
