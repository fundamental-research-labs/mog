import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { MogSdkError } from '../../errors';
import { validateVersionDomainSupportManifestGate } from './version/domain-support/version-domain-support-gate';

const EXPORT_OPERATION = 'workbook.toXlsx';

export function createExportDomainSupportManifestError(
  diagnostics: readonly VersionStoreDiagnostic[],
): MogSdkError {
  const primary = diagnostics[0];

  return new MogSdkError(
    'EXPORT_ERROR',
    'workbook.toXlsx() cannot export this versioned workbook because its document domain support manifest is missing or does not prove XLSX export coverage.',
    {
      operation: EXPORT_OPERATION,
      details: {
        issue: 'export-domain-support-manifest-blocked',
        operation: EXPORT_OPERATION,
        diagnostics,
        mutationGuarantee: 'no-write-attempted',
      },
      diagnostics: {
        domain: 'VERSION',
        issueCode: primary?.issueCode ?? 'VERSION_DOMAIN_SUPPORT_MANIFEST_BLOCKED',
        severity: 'error',
      },
    },
  );
}

export async function assertWorkbookXlsxExportDomainSupportManifest(
  ctx: DocumentContext,
): Promise<void> {
  const diagnostics = await validateVersionDomainSupportManifestGate(ctx, 'export');
  if (diagnostics.length > 0) {
    throw createExportDomainSupportManifestError(diagnostics);
  }
}
