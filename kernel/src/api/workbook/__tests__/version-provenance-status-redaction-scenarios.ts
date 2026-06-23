import { expect, it } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { createMockCtx, PROVENANCE_STATUS_CODES } from './version-provenance-status-test-utils';

export function registerProvenanceStatusRedactionScenarios(): void {
  it('projects only redaction-safe provenance status classifications', async () => {
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          provenanceTruthService: {
            vc09ProvenanceTruthComplete: true,
            vc09ProvenanceStatusProjection: {
              schemaVersion: 1,
              source: 'provider-backed-sync-provenance-status',
              redaction: 'classification-only',
              classifications: [
                {
                  classification: 'blockedBatchFailure',
                  safe: true,
                  complete: true,
                  providerRefId: 'provider-secret-ref',
                  payloadHash: 'raw-payload-hash',
                  updateId: 'raw-sync-update-id',
                  batchId: 'raw-sync-batch-id',
                  batchStatusId: 'raw-sync-batch-status-id',
                },
                {
                  classification: 'mixedRemote',
                  safe: true,
                  complete: true,
                  remoteSessionId: 'client-secret-session',
                  correlationId: 'client-secret-correlation',
                  stableOriginId: 'raw-stable-origin-id',
                  providerEpoch: 'raw-provider-epoch',
                  roomId: 'raw-sync-room-id',
                  sequence: 'raw-sync-sequence',
                },
                {
                  classification: 'legacyRawUnknown',
                  providerId: 'provider-secret-id',
                  orderedSubUpdatePayloadHashes: ['raw-sub-update-payload-hash'],
                },
                {
                  classification: 'quarantine',
                  quarantineRecordId: 'provider-secret-quarantine',
                },
                {
                  classification: 'disconnect',
                  clientId: 'client-secret-id',
                },
                {
                  classification: 'futureRawProviderClassification',
                  providerRefId: 'provider-secret-future',
                },
              ],
            },
          },
        },
      }),
    );

    const status = await version.getStatus();
    const diagnosticCodes = status.provenanceAdmission.diagnostics.map(
      (diagnostic) => diagnostic.code,
    );

    expect(diagnosticCodes).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present', ...PROVENANCE_STATUS_CODES]),
    );
    expect(diagnosticCodes).not.toContain(
      'version.provenanceAdmission.status.futureRawProviderClassification',
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.blockedBatchFailure',
          data: expect.objectContaining({
            classification: 'blockedBatchFailure',
            commitGrouping: 'blockedBatchFailure',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.mixedRemote',
          data: expect.objectContaining({
            classification: 'mixedRemote',
            commitGrouping: 'blockedMixedRemote',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.legacyRawUnknown',
          data: expect.objectContaining({
            classification: 'legacyRawUnknown',
            sourceKind: 'legacyRawUnknown',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.quarantine',
          data: expect.objectContaining({
            classification: 'quarantine',
            lifecycleClassification: 'quarantine',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.disconnect',
          data: expect.objectContaining({
            classification: 'disconnect',
            lifecycleClassification: 'disconnect',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
      ]),
    );

    const publicStatusJson = JSON.stringify(status.provenanceAdmission);
    for (const rawMaterial of [
      'provider-secret-ref',
      'raw-payload-hash',
      'raw-sync-update-id',
      'raw-sync-batch-id',
      'raw-sync-batch-status-id',
      'client-secret-session',
      'client-secret-correlation',
      'raw-stable-origin-id',
      'raw-provider-epoch',
      'raw-sync-room-id',
      'raw-sync-sequence',
      'provider-secret-id',
      'raw-sub-update-payload-hash',
      'provider-secret-quarantine',
      'client-secret-id',
      'provider-secret-future',
    ]) {
      expect(publicStatusJson).not.toContain(rawMaterial);
    }
  });
}
