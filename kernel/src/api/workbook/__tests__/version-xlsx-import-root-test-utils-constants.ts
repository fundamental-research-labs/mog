import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

export const DOCUMENT_ID = 'vc10-xlsx-import-root';
export const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-clean-export';
export const TRUSTED_ROUNDTRIP_DOCUMENT_ID = 'vc10-xlsx-trusted-roundtrip';
export const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export';
export const METADATA_REPLACE_DOCUMENT_ID = 'vc10-xlsx-metadata-replace';
export const METADATA_TRUST_DOCUMENT_ID = 'vc10-xlsx-metadata-trust';
export const METADATA_TRUST_REIMPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-trust-reimport';
export const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
export const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
export const OTHER_SEMANTIC_CHANGE_SET_DIGEST = objectDigest('3');
export const OTHER_SNAPSHOT_ROOT_DIGEST = objectDigest('4');
export const REF_REVISION = { kind: 'counter', value: '1' } as const;
export const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;
export const RAW_METADATA_DIAGNOSTIC_SECRET = 'vc10-raw-metadata-diagnostic-secret';

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
