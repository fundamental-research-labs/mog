import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';

type StandardChartExportAuthority = NonNullable<
  NonNullable<ChartFloatingObject['ooxml']>['standardChartExportAuthority']
>;

export function snapshotPackageAuthority(
  chart: ChartFloatingObject,
): ResolvedChartSpecSnapshot['packageAuthority'] | undefined {
  const authority = chart.ooxml?.standardChartExportAuthority;
  const provenance = chart.ooxml?.standardChartProvenance;
  if (!authority && !provenance) return undefined;

  return {
    source: authority?.packageOwner ?? provenance?.originalPath ?? 'standardChart',
    fingerprint: authority?.projectionFingerprint ?? provenance?.projectionFingerprint,
    status: packageAuthorityStatus(authority),
    details: {
      kind: 'standardChart',
      validity: authority?.validity,
      chartPartRevision: authority?.chartPartRevision,
      packageOwner: authority?.packageOwner,
      relationshipClosureCurrent: authority?.relationshipClosureCurrent,
      staleReason: authority?.staleReason,
      projectionSchemaVersion: provenance?.projectionSchemaVersion,
      originalPath: provenance?.originalPath,
      relsPath: provenance?.relsPath,
      auxiliaryPaths: provenance?.auxiliaryPaths,
      relationshipCount: provenance?.relationships?.length,
    },
  };
}

export function packageAuthorityStatus(
  authority: StandardChartExportAuthority | undefined,
): NonNullable<ResolvedChartSpecSnapshot['packageAuthority']>['status'] {
  if (!authority) return 'unknown';
  if (authority.validity === 'current')
    return authority.relationshipClosureCurrent === false ? 'stale' : 'current';
  if (authority.validity === 'unverified') return 'unknown';
  return 'stale';
}

export function packageAuthorityDiagnostics(chart: ChartFloatingObject): string[] {
  const authority = chart.ooxml?.standardChartExportAuthority;
  if (!authority) return [];
  const status = packageAuthorityStatus(authority);
  if (status !== 'stale') return [];
  const validity = authority.validity ?? 'unknown';
  const reason =
    authority.staleReason ??
    (authority.relationshipClosureCurrent === false
      ? 'chart relationship graph is not closed'
      : undefined);
  return [
    reason
      ? `standard chart package authority is ${validity}: ${reason}`
      : `standard chart package authority is ${validity}`,
  ];
}

export function importStatusUnsupportedDiagnostics(importStatus: unknown): string[] {
  if (typeof importStatus !== 'object' || importStatus === null) return [];
  const diagnostics = (importStatus as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];

  const messages: string[] = [];
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic !== 'object' || diagnostic === null) continue;
    const message = (diagnostic as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) messages.push(message);
  }
  return Array.from(new Set(messages));
}
