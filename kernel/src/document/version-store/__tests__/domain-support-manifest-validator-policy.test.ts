import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { domainRow, freshManifest, NOW } from './domain-support-manifest-validator-fixtures';

describe('validateDomainSupportManifest policy rows', () => {
  it('fails closed when a policy row omits matrixRowId', () => {
    const row = domainRow('filters') as any;
    delete row.matrixRowId;
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

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
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

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
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('filters', { domainPolicyId: 'internal/Plan VC-06' }),
        ],
      }),
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
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('tables', {
          // @ts-expect-error intentionally invalid class
          domainClass: 'not-a-real-class',
        }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-domain-class');
      expect(diag?.domainId).toBe('tables');
    }
  });

  it('fails closed when required policy fields are missing', () => {
    const row = domainRow('filters') as any;
    delete row.capturePolicy;
    delete row.writeAdmissionMode;
    delete row.rolloutStage;
    delete row.historyAccess;
    delete row.redactionPolicy;
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

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
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

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
});
