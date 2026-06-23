import type { VersionGraphNamespace } from '../object-store';
import type { PendingRemoteSegmentStore } from '../pending-remote-segment-store';
import type { VersionGraphStore } from '../provider';

export function graphWithObjectWriteFailure(graph: VersionGraphStore): VersionGraphStore {
  return {
    ...graph,
    putObjects: async () => ({
      status: 'failed',
      mutationGuarantee: 'no-objects-written',
      diagnostics: [
        {
          code: 'VERSION_STORE_UNAVAILABLE',
          severity: 'error',
          message: 'Injected object write failure for provider-raw authority-raw.',
          objectType: 'workbook.mutationSegment.v1',
          details: {
            providerId: 'provider-raw',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
          },
        },
      ],
    }),
  };
}

export function failingReadPendingRemoteSegmentStore(
  namespace: VersionGraphNamespace,
): PendingRemoteSegmentStore {
  return {
    namespace,
    reserveSegment: async () => {
      throw new Error('unexpected reserve');
    },
    readBySegmentId: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    readByIdempotencyKey: async () => ({
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Injected read failure.',
          recoverability: 'retry',
          details: {
            providerId: 'provider-raw',
            providerRefId: 'ProviderA',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
            stableDetail: 'kept',
          },
        },
      ],
    }),
    listByState: async () => ({ status: 'success', records: [], diagnostics: [] }),
    completeSegment: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
  };
}

export function failingReservePendingRemoteSegmentStore(
  namespace: VersionGraphNamespace,
): PendingRemoteSegmentStore {
  return {
    namespace,
    reserveSegment: async () => ({
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Injected reservation failure.',
          recoverability: 'retry',
          details: {
            providerId: 'provider-raw',
            providerRefId: 'ProviderA',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
            stableDetail: 'kept',
          },
        },
      ],
    }),
    readBySegmentId: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    readByIdempotencyKey: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    listByState: async () => ({ status: 'success', records: [], diagnostics: [] }),
    completeSegment: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
  };
}
