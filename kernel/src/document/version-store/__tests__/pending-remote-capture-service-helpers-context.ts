import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { PendingRemoteSegmentOperationContext } from '../pending-remote-segment-store';
import type { VersionDocumentScope } from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

export function semanticChange(changeId: string) {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'cell-1',
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: 'Remote value' },
  };
}

export function pendingRemoteOperationContext(
  overrides: Partial<VersionOperationContext> & {
    readonly providerId?: string;
    readonly authorityRef?: string;
    readonly remoteSessionId?: string;
    readonly correlationId?: string;
    readonly causationIds?: readonly string[];
    readonly collaboration?: Partial<NonNullable<VersionOperationContext['collaboration']>>;
  } = {},
): PendingRemoteSegmentOperationContext {
  const {
    providerId,
    authorityRef,
    remoteSessionId,
    correlationId,
    causationIds,
    collaboration: collaborationOverrides,
    ...contextOverrides
  } = overrides;
  const collaboration = {
    sourceKind: 'providerLiveInbound',
    originKind: 'provider',
    stableOriginId: 'provider-stable-1',
    providerId: providerId ?? 'provider-raw-1',
    providerKind: 'indexeddb',
    authorityRef: authorityRef ?? 'authority-raw-1',
    epoch: 'epoch-1',
    updateId: 'remote-update-1',
    sequence: '7',
    payloadHash: '3'.repeat(64),
    provenancePayloadHash: '5'.repeat(64),
    trustStatus: 'verified',
    authorState: 'singleRemote',
    remoteSessionId: remoteSessionId ?? 'remote-session-raw-1',
    correlationId: correlationId ?? 'correlation-raw-1',
    causationIds: causationIds ?? ['cause-raw-1'],
    replay: false,
    system: false,
    commitGrouping: 'pendingRemote',
    validationDiagnosticCount: 0,
    ...collaborationOverrides,
  } satisfies NonNullable<VersionOperationContext['collaboration']>;

  return {
    operationId: contextOverrides.operationId ?? 'operation-1',
    kind: 'sync-import',
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'workbook-1',
    domainIds: ['cells.values'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...contextOverrides,
    collaboration,
  };
}
