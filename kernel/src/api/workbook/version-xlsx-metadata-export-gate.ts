import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { MogSdkError } from '../../errors';

const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';
const METADATA_EXPORT_OPERATION = 'workbook.toXlsx';
const METADATA_EXPORT_BLOCKED_ISSUE_CODE = 'VERSION_XLSX_METADATA_EXPORT_BLOCKED';

export type MogVersionMetadataExportBlockReason =
  | 'redaction-failed'
  | 'head-read-failed'
  | 'head-unverified'
  | 'stale-head'
  | 'commit-missing';

export function createMogVersionMetadataExportBlockedError(
  reason: MogVersionMetadataExportBlockReason,
): MogSdkError {
  const diagnostics = [mogVersionMetadataExportBlockedDiagnostic(reason)];
  return new MogSdkError(
    'EXPORT_ERROR',
    'workbook.toXlsx() cannot include Mog version metadata because the current version head, object-store authority, and redaction requirements were not proven.',
    {
      operation: METADATA_EXPORT_OPERATION,
      details: {
        issue: 'metadata-export-blocked',
        operation: METADATA_EXPORT_OPERATION,
        metadataIssue: reason,
        sidecarPart: MOG_VERSION_METADATA_PART,
        mutationGuarantee: 'no-write-attempted',
        diagnostics,
      },
      diagnostics: {
        domain: 'VERSION',
        issueCode: METADATA_EXPORT_BLOCKED_ISSUE_CODE,
        severity: 'error',
      },
    },
  );
}

function mogVersionMetadataExportBlockedDiagnostic(
  reason: MogVersionMetadataExportBlockReason,
): VersionStoreDiagnostic {
  return {
    issueCode: METADATA_EXPORT_BLOCKED_ISSUE_CODE,
    severity: 'error',
    recoverability: reason === 'stale-head' ? 'retry' : 'none',
    messageTemplateId: 'version.xlsx.metadataExportBlocked',
    safeMessage:
      'Mog version metadata export is blocked because the sidecar cannot be proven current and redacted.',
    payload: {
      operation: 'export',
      phase: 'export-sidecar',
      reason,
      sidecarPart: MOG_VERSION_METADATA_PART,
      redacted: true,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
