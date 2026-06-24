import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphCommitRef,
} from '../../../document/version-store/graph';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import type { XlsxVersionImportRootProvenance } from '../../../document/version-store/xlsx-import-root';
import { SIDE_CAR_PART } from './version-xlsx-external-change-branch-helpers-constants';

export function absentMetadataProvenance(byteLength: number): XlsxVersionImportRootProvenance {
  return {
    kind: 'xlsx',
    source: { sourceType: 'bytes', byteLength },
    diagnostics: [],
    versionMetadataTrust: {
      status: 'absent',
      sidecarPart: SIDE_CAR_PART,
    },
  };
}

export function trustedProvenance(
  documentId: string,
  baseCommit: WorkbookCommit,
  exportedHead?: VersionGraphCommitRef,
  options?: {
    readonly trustStatus?: 'trusted' | 'trusted-stale-base';
    readonly diagnostics?: XlsxVersionImportRootProvenance['diagnostics'];
    readonly semanticChangeSetDigest?: ObjectDigest;
    readonly snapshotRootDigest?: ObjectDigest;
  },
): XlsxVersionImportRootProvenance {
  return {
    kind: 'xlsx',
    source: { sourceType: 'bytes', byteLength: 256 },
    diagnostics: options?.diagnostics ?? [],
    versionMetadataTrust: {
      status: options?.trustStatus ?? 'trusted',
      sidecarPart: SIDE_CAR_PART,
      redacted: true,
    },
    versionMetadataHeadCandidate: {
      documentId,
      head: {
        commitId: baseCommit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: VERSION_GRAPH_HEAD_REF,
        refRevision: exportedHead?.refRevision ?? { kind: 'counter', value: '1' },
        semanticChangeSetDigest:
          options?.semanticChangeSetDigest ?? baseCommit.payload.semanticChangeSetDigest,
        snapshotRootDigest: options?.snapshotRootDigest ?? baseCommit.payload.snapshotRootDigest,
      },
    },
  };
}

export function staleTrustedBaseDiagnostic(): XlsxVersionImportRootProvenance['diagnostics'][number] {
  return {
    id: 'mog-version-metadata-trusted-stale-base',
    code: 'mogVersionMetadataStale',
    severity: 'warning',
    feature: 'workbook-metadata',
    recoverability: 'mergeRequired',
    message:
      'Mog version metadata sidecar was trusted, but the current head advanced; external edits were routed to an external-change branch.',
    reason: 'trusted-stale-base',
    details: {
      kind: 'mogVersionMetadataTrust',
      reason: 'trusted-stale-base',
      trusted: true,
      staleBase: true,
      branchRouting: 'external-change',
      redacted: true,
    },
    importPhases: ['parser'],
    firstImportPhase: 'parser',
  };
}
