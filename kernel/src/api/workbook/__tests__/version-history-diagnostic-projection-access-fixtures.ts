import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

export function sensitiveDiagnostic(
  data: NonNullable<VersionDiagnostic['data']>,
): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.hostCapabilityDenied',
    severity: 'error',
    message:
      'Raw detail mentions hidden sheets, deleted rows, protected ranges, agent traces, and opaque payloads.',
    dependency: 'hostCapability',
    data: {
      ...data,
      hiddenSheetId: 'sheet-secret',
      deletedRowId: 'row-secret',
      protectedRangeId: 'range-secret',
      agentTraceId: 'run-secret',
      opaqueObjectDigest: 'digest-secret',
    } as VersionDiagnostic['data'],
  };
}

export function sensitiveDomainDiagnosticCases(): readonly (readonly VersionDiagnostic[])[] {
  const cases = [
    sensitiveDiagnostic({
      domain: 'hidden-sheet',
      capability: 'version:read',
      hiddenSheetId: 'hidden-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'protected-range',
      deniedCapabilities: ['version:diff'],
      protectedRangeId: 'protected-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'deleted-object',
      capability: 'version:commit',
      deletedObjectId: 'deleted-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'external-link',
      deniedCapabilities: ['version:remotePromote'],
      externalTargetId: 'external-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'agent-proposal',
      capability: 'version:proposal',
      agentRunId: 'agent-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'opaque-payload',
      deniedCapabilities: ['version:provenance'],
      opaqueObjectDigest: 'opaque-domain-secret',
    }),
  ] as const;

  return cases.map((diagnostic, index) => [diagnostic, ...cases.slice(0, index)]);
}
