import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { domainRow, freshManifest, NOW } from './domain-support-manifest-validator-fixtures';

export function registerPolicyOperationScenarios(): void {
  it('blocks durable operations when policy write admission is block', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'cells.values'
          ? domainRow(id, {
              writeAdmissionMode: 'block',
            })
          : domainRow(id),
      ),
    });

    expect(validateDomainSupportManifest(manifest, { now: NOW }).ok).toBe(true);

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.find((d) => d.code === 'write-admission-mode-blocked'),
      ).toMatchObject({
        domainId: 'cells.values',
        matrixRowId: 'cells.values',
        policyField: 'writeAdmissionMode',
        policyValue: 'block',
      });
    }
  });
}
