import { INTERNAL_INTERACTIVE_DEFERRED_IMPORT } from '@mog-sdk/kernel/internal';
import type { DocumentHandle } from '@mog-sdk/kernel';
import type { StandaloneBrowserShellResult } from '../../host-adapters/standalone-browser-host';

export async function importInteractiveHostBackedDocument(
  hostResult: StandaloneBrowserShellResult,
): Promise<DocumentHandle> {
  const { importHostBackedDocument } = await import('@mog/kernel-host-internal');
  const result = await importHostBackedDocument(hostResult.kernelContext, hostResult.bindings, {
    interactiveDeferredImportToken: INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  });
  return result.handle;
}
