import type {
  VersionGraphCommitContentInput,
  VersionGraphStoreDiagnostic,
} from './graph-store-types';
import { diagnostic } from './graph-store-diagnostics';
import { versionGraphNamespaceKey, type VersionObjectRecord } from '../object-store';

export function validateInputNamespaces(
  expectedNamespaceKey: string,
  input: VersionGraphCommitContentInput,
): readonly VersionGraphStoreDiagnostic[] {
  const diagnostics: VersionGraphStoreDiagnostic[] = [];
  for (const [path, record] of collectInputRecords(input)) {
    if (!hasNamespace(record)) continue;
    try {
      if (versionGraphNamespaceKey(record.namespace) !== expectedNamespaceKey) {
        diagnostics.push(
          diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is outside this graph.', {
            details: { path, namespace: 'redacted' },
          }),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is invalid.', {
          details: { path },
        }),
      );
    }
  }
  return diagnostics;
}

function collectInputRecords(
  input: VersionGraphCommitContentInput,
): readonly (readonly [string, VersionObjectRecord<unknown> | undefined])[] {
  return [
    ['snapshotRootRecord', input.snapshotRootRecord],
    ['semanticChangeSetRecord', input.semanticChangeSetRecord],
    ...(input.mutationSegmentRecords ?? []).map(
      (record, index) => [`mutationSegmentRecords[${index}]`, record] as const,
    ),
    ['redactionSummaryRecord', input.redactionSummaryRecord],
    ['verificationSummaryRecord', input.verificationSummaryRecord],
  ];
}

function hasNamespace(
  record: VersionObjectRecord<unknown> | undefined,
): record is VersionObjectRecord<unknown> {
  return typeof record === 'object' && record !== null && 'namespace' in record;
}
