import { validatePendingRemoteProviderAuthority } from '../pending-remote-authority-gate';

import { pendingRemoteRecord } from './pending-remote-authority-gate-test-helpers';

export function registerPendingRemoteAuthorityGateEligibilityScenarios() {
  it('accepts a verified live single-author provider record with matching reserved identity', async () => {
    const record = await pendingRemoteRecord();

    expect(validatePendingRemoteProviderAuthority(record)).toEqual({ status: 'ok' });
  });

  it.each([
    [
      'quarantine capture policy',
      { operation: { capturePolicy: 'excluded' } },
      { gate: 'promotion-quarantine', field: 'capturePolicy', actual: 'excluded' },
    ],
    [
      'blocked write admission',
      { operation: { writeAdmissionMode: 'block' } },
      { gate: 'promotion-quarantine', field: 'writeAdmissionMode', actual: 'block' },
    ],
    [
      'missing durable gap receipt',
      { collaboration: { validationDiagnosticCount: undefined } },
      { gate: 'durable-gap-receipt', field: 'validationDiagnosticCount', actual: null },
    ],
    [
      'quarantine-required validation diagnostics',
      {
        collaboration: {
          validationDiagnosticCount: 1,
          exclusionReason: 'missingProof',
          exclusionSubreason: 'missingProofAudience',
        },
      },
      {
        gate: 'durable-gap-receipt',
        field: 'validationDiagnosticCount',
        actual: 1,
        exclusionReason: 'missingProof',
        exclusionSubreason: 'missingProofAudience',
      },
    ],
  ] as const)('blocks %s as unknown authority', async (_label, options, details) => {
    const record = await pendingRemoteRecord(options);

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-unknown',
      details: {
        expected: details.field === 'validationDiagnosticCount' ? 0 : expect.any(String),
        ...details,
      },
    });
  });
}
