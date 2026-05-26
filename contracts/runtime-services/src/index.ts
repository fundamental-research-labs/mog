export type { RuntimeErrorCategory, RuntimeErrorEnvelope } from './error-envelope';

export type { AuditActor, AuditOutcome, RuntimeAuditEvent } from './audit-event';

export type {
  ServicePrincipal,
  SessionState,
  ServiceSession,
  TenantScope,
  RoomGrant,
  SourceImportHandoff,
  ExportMaterializationHandoff,
  ProviderMaterializationRef,
  RawByteMaterializationDecision,
} from './service-contracts';

export type {
  ProtocolVersion,
  CompatibilityStatus,
  CompatibilityResult,
  ProtocolHandshake,
} from './protocol-version';

export type {
  DeploymentProfile,
  ServiceHealth,
  ServiceReadiness,
  ServiceDiagnostics,
} from './deployment';
