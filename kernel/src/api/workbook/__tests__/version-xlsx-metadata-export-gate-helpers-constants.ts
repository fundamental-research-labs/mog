import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

export const SOURCE_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-source';
export const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-clean';
export const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate';
export const STALE_IMPORTED_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-stale-imported';
export const STALE_IMPORTED_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-stale-workspace';
export const METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-workspace';
export const OTHER_METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-other-workspace';
export const COPIED_METADATA_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-copied';
export const METADATA_EXPORT_GRAPH_ID = 'vc10-xlsx-metadata-export-gate-graph';
export const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const STALE_SOURCE_ROOT_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
export const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
export const REF_REVISION = { kind: 'counter', value: '1' } as const;
export const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;
export const STALE_IMPORTED_REF_REVISION = {
  kind: 'opaque',
  value: 'vc10-xlsx-metadata-export-gate-stale-ref-revision',
} as const;
export const UNSAFE_AUTHORITY_DIAGNOSTICS = [
  { message: 'vc10-metadata-export-authority-leak', dependency: 'secret://authority' },
] as const;

export function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
