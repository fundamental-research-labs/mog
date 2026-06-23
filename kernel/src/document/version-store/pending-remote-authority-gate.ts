import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';

type PendingRemoteAuthorityGateDetails = Readonly<Record<string, string | number | boolean | null>>;

export type PendingRemoteAuthorityGateSkipReason =
  | 'provider-authority-stale'
  | 'provider-authority-unknown';

export type PendingRemoteAuthorityGateResult =
  | { readonly status: 'ok' }
  | {
      readonly status: 'blocked';
      readonly reason: PendingRemoteAuthorityGateSkipReason;
      readonly message: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    };

export function validatePendingRemoteProviderAuthority(
  record: PendingRemoteSegmentRecord,
): PendingRemoteAuthorityGateResult {
  const collaboration = record.operationContext.collaboration;
  if (!collaboration) {
    return unknownAuthority('Pending remote segment is missing collaboration provenance.', {
      gate: 'collaboration-provenance',
      field: 'collaboration',
      present: false,
    });
  }
  if (record.operationContext.capturePolicy !== 'commitEligible') {
    return unknownAuthority('Pending remote promotion requires commit-eligible updates.', {
      gate: 'promotion-quarantine',
      field: 'capturePolicy',
      expected: 'commitEligible',
      actual: record.operationContext.capturePolicy,
    });
  }
  if (record.operationContext.writeAdmissionMode !== 'capture') {
    return unknownAuthority('Pending remote promotion requires captured durable writes.', {
      gate: 'promotion-quarantine',
      field: 'writeAdmissionMode',
      expected: 'capture',
      actual: record.operationContext.writeAdmissionMode,
    });
  }
  if (
    typeof collaboration.validationDiagnosticCount !== 'number' ||
    collaboration.validationDiagnosticCount !== 0
  ) {
    return unknownAuthority(
      'Pending remote promotion requires validation-clean durable sync receipt metadata.',
      {
        gate: 'durable-gap-receipt',
        field: 'validationDiagnosticCount',
        expected: 0,
        actual:
          typeof collaboration.validationDiagnosticCount === 'number'
            ? collaboration.validationDiagnosticCount
            : null,
        exclusionReason: collaboration.exclusionReason ?? null,
        exclusionSubreason: collaboration.exclusionSubreason ?? null,
      },
    );
  }
  if (collaboration.trustStatus !== 'verified') {
    return unknownAuthority('Pending remote promotion requires verified provider authority.', {
      gate: 'provider-authority',
      field: 'trustStatus',
      expected: 'verified',
      trustStatus: collaboration.trustStatus,
    });
  }
  if (collaboration.authorState !== 'singleRemote') {
    return unknownAuthority(
      collaboration.authorState === 'mixedRemote'
        ? 'Pending remote promotion blocks coauthored or mixed-author remote updates.'
        : 'Pending remote promotion requires a single remote author.',
      {
        gate: 'author-identity',
        field: 'authorState',
        expected: 'singleRemote',
        actual: collaboration.authorState,
        exclusionReason: collaboration.exclusionReason ?? null,
        exclusionSubreason: collaboration.exclusionSubreason ?? null,
      },
    );
  }
  if (collaboration.replay) {
    return staleAuthority(
      'Pending remote promotion requires live remote high-water provenance, not replayed provider bytes.',
      {
        gate: 'replay-high-water',
        field: 'replay',
        expected: false,
        actual: true,
        sourceKind: collaboration.sourceKind,
      },
    );
  }
  if (collaboration.system) {
    return unknownAuthority('Pending remote promotion does not promote system sync updates.', {
      gate: 'author-identity',
      field: 'system',
      expected: false,
      actual: true,
      sourceKind: collaboration.sourceKind,
    });
  }
  if (!isNonEmptyString(collaboration.authorityRef)) {
    return unknownAuthority('Pending remote promotion requires an authority reference.', {
      gate: 'provider-identity',
      field: 'authorityRef',
      present: false,
    });
  }
  if (!isNonEmptyString(collaboration.stableOriginId)) {
    return unknownAuthority('Pending remote promotion requires a stable provider origin.', {
      gate: 'provider-identity',
      field: 'stableOriginId',
      present: false,
    });
  }
  if (collaboration.originKind === 'provider' && !isNonEmptyString(collaboration.providerId)) {
    return unknownAuthority('Pending remote promotion requires a provider binding.', {
      gate: 'provider-identity',
      field: 'providerId',
      present: false,
    });
  }
  if (collaboration.originKind === 'room' && !isNonEmptyString(collaboration.roomId)) {
    return unknownAuthority('Pending remote promotion requires a room binding.', {
      gate: 'provider-identity',
      field: 'roomId',
      present: false,
    });
  }
  if (collaboration.originKind !== 'provider' && collaboration.originKind !== 'room') {
    return unknownAuthority('Pending remote promotion requires provider or room authority.', {
      gate: 'provider-identity',
      field: 'originKind',
      expected: 'provider|room',
      originKind: collaboration.originKind,
    });
  }
  const expectedSourceKind =
    collaboration.originKind === 'provider' ? 'providerLiveInbound' : 'collaborationLiveRemote';
  if (collaboration.sourceKind !== expectedSourceKind) {
    return staleAuthority(
      'Pending remote promotion requires current live remote source provenance.',
      {
        gate: 'replay-high-water',
        field: 'sourceKind',
        expected: expectedSourceKind,
        actual: collaboration.sourceKind,
      },
    );
  }
  if (!isNonEmptyString(collaboration.epoch)) {
    return staleAuthority('Pending remote promotion requires a current provider authority epoch.', {
      gate: 'replay-high-water',
      field: 'epoch',
      present: false,
    });
  }
  if (!isNonEmptyString(collaboration.updateId)) {
    return staleAuthority('Pending remote promotion requires a live remote update id.', {
      gate: 'replay-high-water',
      field: 'updateId',
      present: false,
    });
  }
  if (!isNonEmptyString(collaboration.payloadHash)) {
    return staleAuthority('Pending remote promotion requires a live remote payload hash.', {
      gate: 'replay-high-water',
      field: 'payloadHash',
      present: false,
    });
  }
  const author = record.operationContext.author;
  if (!isNonEmptyString(author.authorId)) {
    return unknownAuthority('Pending remote promotion requires durable remote author identity.', {
      gate: 'author-identity',
      field: 'authorId',
      present: false,
    });
  }
  if (author.actorKind !== 'user') {
    return unknownAuthority('Pending remote promotion requires a user remote author identity.', {
      gate: 'author-identity',
      field: 'actorKind',
      expected: 'user',
      actual: author.actorKind,
    });
  }
  if (!isNonEmptyString(collaboration.remoteSessionId)) {
    return unknownAuthority('Pending remote promotion requires durable remote session identity.', {
      gate: 'author-identity',
      field: 'remoteSessionId',
      present: false,
    });
  }
  if (author.sessionId !== collaboration.remoteSessionId) {
    return staleAuthority(
      'Pending remote segment author session no longer matches its collaboration provenance.',
      {
        gate: 'author-identity',
        field: 'remoteSessionId',
        authorPresent: isNonEmptyString(author.sessionId),
        collaborationPresent: true,
      },
    );
  }
  if (isSystemAuthoredPlaceholder(author.authorId)) {
    return unknownAuthority('Pending remote promotion requires a single durable remote author.', {
      gate: 'author-identity',
      field: 'authorId',
      placeholder: true,
    });
  }

  const identityMismatch = firstIdentityMismatch(record);
  if (identityMismatch) {
    return staleAuthority(
      'Pending remote segment authority no longer matches its reserved sync identity.',
      identityMismatch,
    );
  }
  return { status: 'ok' };
}

function unknownAuthority(
  message: string,
  details: PendingRemoteAuthorityGateDetails = {},
): PendingRemoteAuthorityGateResult {
  return {
    status: 'blocked',
    reason: 'provider-authority-unknown',
    message,
    details,
  };
}

function staleAuthority(
  message: string,
  details: PendingRemoteAuthorityGateDetails = {},
): PendingRemoteAuthorityGateResult {
  return {
    status: 'blocked',
    reason: 'provider-authority-stale',
    message,
    details,
  };
}

function firstIdentityMismatch(
  record: PendingRemoteSegmentRecord,
): PendingRemoteAuthorityGateDetails | null {
  const identity = record.syncIdentity;
  const collaboration = record.operationContext.collaboration;
  const fields = [
    'sourceKind',
    'originKind',
    'stableOriginId',
    'providerId',
    'authorityRef',
    'roomId',
    'epoch',
    'updateId',
    'sequence',
    'payloadHash',
  ] as const;

  for (const field of fields) {
    if (identity[field] === collaboration[field]) continue;
    return {
      gate:
        field === 'updateId' || field === 'sequence' || field === 'payloadHash'
          ? 'replay-high-water'
          : 'provider-identity',
      field,
      reservedPresent: isNonEmptyString(identity[field]),
      collaborationPresent: isNonEmptyString(collaboration[field]),
    };
  }
  return null;
}

function isSystemAuthoredPlaceholder(authorId: string): boolean {
  return authorId === 'sync:mixed-remote' || authorId.startsWith('sync:unknown:');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
