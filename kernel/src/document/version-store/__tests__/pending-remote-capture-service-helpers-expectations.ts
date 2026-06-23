import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionObjectRecord } from '../object-store';

export function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

export function expectMutationSegmentHasNoRawProviderIdentity(
  record: VersionObjectRecord<unknown> | undefined,
): void {
  expect(record).toBeDefined();
  const payload = record?.preimage.payload;
  if (!isRecord(payload)) throw new Error('expected mutation segment payload');
  const operationContext = payload.operationContext;
  if (!isRecord(operationContext) || !isRecord(operationContext.collaboration)) {
    throw new Error('expected mutation segment operation context');
  }
  expectNoRawProviderIdentity(
    operationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
  const mutations = payload.mutations;
  if (!Array.isArray(mutations) || !isRecord(mutations[0])) {
    throw new Error('expected mutation segment mutation payload');
  }
  const mutationOperationContext = mutations[0].operationContext;
  if (!isRecord(mutationOperationContext) || !isRecord(mutationOperationContext.collaboration)) {
    throw new Error('expected mutation operation context payload');
  }
  expectNoRawProviderIdentity(
    mutationOperationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
}

export function expectHistorySuspensionMutationSegment(
  record: VersionObjectRecord<unknown> | undefined,
): void {
  expect(record).toBeDefined();
  const payload = record?.preimage.payload;
  if (!isRecord(payload)) throw new Error('expected mutation segment payload');
  expect(payload).toMatchObject({
    historySuspension: {
      status: 'verified',
      reason: 'no-matching-semantic-mutations',
      capturePolicy: 'historyGap',
      writeAdmissionMode: 'captureSuspendedWithGap',
    },
    mutations: [],
    changeIds: [],
  });
  const operationContext = payload.operationContext;
  if (!isRecord(operationContext) || !isRecord(operationContext.collaboration)) {
    throw new Error('expected mutation segment operation context');
  }
  expect(operationContext).toMatchObject({
    capturePolicy: 'historyGap',
    writeAdmissionMode: 'captureSuspendedWithGap',
  });
  expectNoRawProviderIdentity(
    operationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
