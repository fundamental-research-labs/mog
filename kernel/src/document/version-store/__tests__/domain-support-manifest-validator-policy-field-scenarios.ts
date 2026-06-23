import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { domainRow, NOW } from './domain-support-manifest-validator-fixtures';
import { policyManifestWithAdditionalDomain } from './domain-support-manifest-validator-policy-test-helpers';

export function registerPolicyFieldScenarios(): void {
  it('fails closed when required policy fields are missing', () => {
    const row = domainRow('filters') as any;
    delete row.capturePolicy;
    delete row.writeAdmissionMode;
    delete row.rolloutStage;
    delete row.historyAccess;
    delete row.redactionPolicy;
    const result = validateDomainSupportManifest(policyManifestWithAdditionalDomain(row), {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining([
          'capture-policy-missing',
          'write-admission-mode-missing',
          'rollout-stage-missing',
          'history-access-missing',
          'redaction-policy-missing',
        ]),
      );
      expect(result.diagnostics.find((d) => d.code === 'history-access-missing')).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'historyAccess',
      });
    }
  });

  it('fails closed when policy fields reference unknown values', () => {
    const row = domainRow('filters') as any;
    row.capturePolicy = 'captureEventually';
    row.writeAdmissionMode = 'bestEffort';
    row.rolloutStage = 'surprise';
    row.historyAccess = {
      readMode: 'everything',
      writeMode: 'sometimes',
      redactionPolicy: 'trust-me',
    };
    row.redactionPolicy = 'unknown';
    const result = validateDomainSupportManifest(policyManifestWithAdditionalDomain(row), {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining([
          'unknown-capture-policy',
          'unknown-write-admission-mode',
          'unknown-rollout-stage',
          'unknown-history-read-mode',
          'unknown-history-write-mode',
          'unknown-history-redaction-policy',
          'unknown-redaction-policy',
        ]),
      );
      expect(
        result.diagnostics.find((d) => d.code === 'unknown-write-admission-mode'),
      ).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'writeAdmissionMode',
        policyValue: 'bestEffort',
      });
    }
  });
}
