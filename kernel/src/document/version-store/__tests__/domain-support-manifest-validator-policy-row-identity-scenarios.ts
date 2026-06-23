import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { domainRow, NOW } from './domain-support-manifest-validator-fixtures';
import { policyManifestWithAdditionalDomain } from './domain-support-manifest-validator-policy-test-helpers';

export function registerPolicyRowIdentityScenarios(): void {
  it('fails closed when a policy row omits matrixRowId', () => {
    const row = domainRow('filters') as any;
    delete row.matrixRowId;
    const result = validateDomainSupportManifest(policyManifestWithAdditionalDomain(row), {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'matrix-row-id-missing')).toMatchObject({
        domainId: 'filters',
      });
    }
  });

  it('fails closed when a policy row omits domainPolicyId', () => {
    const row = domainRow('filters') as any;
    delete row.domainPolicyId;
    const result = validateDomainSupportManifest(policyManifestWithAdditionalDomain(row), {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'domain-policy-id-missing')).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'domainPolicyId',
      });
    }
  });

  it('fails closed when a policy row uses a non-public-safe domainPolicyId', () => {
    const result = validateDomainSupportManifest(
      policyManifestWithAdditionalDomain(
        domainRow('filters', { domainPolicyId: 'internal/Plan VC-06' }),
      ),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'domain-policy-id-malformed')).toMatchObject(
        {
          domainId: 'filters',
          matrixRowId: 'filters',
          policyField: 'domainPolicyId',
          policyValue: 'internal/Plan VC-06',
        },
      );
    }
  });

  it('fails closed when a domain references an unknown domainClass', () => {
    const manifest = policyManifestWithAdditionalDomain(
      domainRow('tables', {
        // @ts-expect-error intentionally invalid class
        domainClass: 'not-a-real-class',
      }),
    );

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-domain-class');
      expect(diag?.domainId).toBe('tables');
    }
  });
}
