import type { ControlPlaneRuntimeKind } from '../control-plane';
import type { VersionRedactionPolicy } from './access-policy';
import type {
  VersionActorKind,
  VersionMetadataDiagnostic,
  VersionMutationSegment,
  VersionOperationContext,
} from './index';

export const VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST = Object.freeze([
  'principal',
  'principalId',
  'principalIds',
  'principalRef',
  'principalScope',
  'principalTag',
  'principalTags',
  'principal_tags',
  'rawPayload',
  'raw_payload',
  'rawPayloadBytes',
  'raw_payload_bytes',
  'payload',
  'payloadBytes',
  'payload_bytes',
  'providerPayload',
  'provider_payload',
  'rawWorkbookBytes',
  'raw_workbook_bytes',
  'workbookBytes',
  'workbook_bytes',
  'credential',
  'credentials',
  'accessToken',
  'access_token',
  'secret',
  'secrets',
] as const);
export type VersionPublicContractPrivateFieldName =
  (typeof VERSION_PUBLIC_CONTRACT_PRIVATE_FIELD_DENY_LIST)[number];

export interface VersionRuntimeOperationActorSummary {
  readonly actorKind?: VersionActorKind | 'unknown';
  readonly redactedAuthorClass: string;
}

export interface VersionRuntimeOperationContext {
  readonly runtimeContextId: string;
  readonly operationContext: VersionOperationContext;
  readonly entrypointIds: readonly string[];
  readonly command?: string;
  readonly runtimeKind?: ControlPlaneRuntimeKind;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly actor: VersionRuntimeOperationActorSummary;
  readonly diagnostics?: readonly VersionMetadataDiagnostic[];
}

export const VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES = Object.freeze([
  'runtimeContextId',
  'operationContext',
  'entrypointIds',
  'command',
  'runtimeKind',
  'redactionPolicy',
  'actor',
  'diagnostics',
] as const satisfies readonly (keyof VersionRuntimeOperationContext)[]);
export type VersionRuntimeOperationContextFieldName =
  (typeof VERSION_RUNTIME_OPERATION_CONTEXT_FIELD_NAMES)[number];

export const VERSION_MUTATION_SEGMENT_FIELD_NAMES = Object.freeze([
  'segmentId',
  'domainId',
  'domainClass',
  'capabilityState',
  'operationKind',
  'objectIds',
  'beforeDigest',
  'afterDigest',
  'redactionPolicy',
  'attachment',
] as const satisfies readonly (keyof VersionMutationSegment)[]);
export type VersionMutationSegmentFieldName = (typeof VERSION_MUTATION_SEGMENT_FIELD_NAMES)[number];
