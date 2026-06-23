import type { VersionCapability, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateVersionOperationGate } from './version-operation-gate';

export function readWorkbookVersionFacadeGate(
  ctx: DocumentContext,
  operation: string,
  capability: VersionCapability,
): readonly VersionStoreDiagnostic[] | null {
  const diagnostics = validateVersionOperationGate(ctx, operation, capability, {
    mutates: false,
  });
  return diagnostics.length > 0 ? diagnostics : null;
}
