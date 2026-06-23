import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';

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
  const identity = record.syncIdentity;
  if (!collaboration) return unknownAuthority('Pending remote segment is missing collaboration provenance.');
  if (collaboration.trustStatus !== 'verified') {
    return unknownAuthority('Pending remote promotion requires verified provider authority.', {
      trustStatus: collaboration.trustStatus,
    });
  }
  if (collaboration.authorState !== 'singleRemote' || collaboration.replay || collaboration.system) {
    return unknownAuthority('Pending remote promotion requires a verified live single-author remote update.', {
      authorState: collaboration.authorState,
      replay: collaboration.replay,
      system: collaboration.system,
    });
  }
  if (!isNonEmptyString(collaboration.authorityRef)) {
    return unknownAuthority('Pending remote promotion requires an authority reference.');
  }
  if (!isNonEmptyString(collaboration.stableOriginId)) {
    return unknownAuthority('Pending remote promotion requires a stable provider origin.');
  }
  if (collaboration.originKind === 'provider' && !isNonEmptyString(collaboration.providerId)) {
    return unknownAuthority('Pending remote promotion requires a provider binding.');
  }
  if (collaboration.originKind === 'room' && !isNonEmptyString(collaboration.roomId)) {
    return unknownAuthority('Pending remote promotion requires a room binding.');
  }
  if (collaboration.originKind !== 'provider' && collaboration.originKind !== 'room') {
    return unknownAuthority('Pending remote promotion requires provider or room authority.', {
      originKind: collaboration.originKind,
    });
  }
  if (!isNonEmptyString(collaboration.epoch)) {
    return staleAuthority('Pending remote promotion requires a current provider authority epoch.');
  }
  if (
    identity.stableOriginId !== collaboration.stableOriginId ||
    identity.authorityRef !== collaboration.authorityRef ||
    identity.epoch !== collaboration.epoch ||
    identity.providerId !== collaboration.providerId ||
    identity.roomId !== collaboration.roomId
  ) {
    return staleAuthority('Pending remote segment authority no longer matches its reserved sync identity.');
  }
  return { status: 'ok' };
}

function unknownAuthority(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): PendingRemoteAuthorityGateResult {
  return {
    status: 'blocked',
    reason: 'provider-authority-unknown',
    message,
    details,
  };
}

function staleAuthority(message: string): PendingRemoteAuthorityGateResult {
  return {
    status: 'blocked',
    reason: 'provider-authority-stale',
    message,
    details: {},
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
