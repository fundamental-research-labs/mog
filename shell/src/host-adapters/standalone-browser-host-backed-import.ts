import type { DocumentHandle } from '@mog-sdk/kernel';
import type { StandaloneBrowserShellResult } from './standalone-browser-host';

export async function importStandaloneBrowserHostBackedInteractiveDocument(
  hostResult: StandaloneBrowserShellResult,
): Promise<DocumentHandle> {
  const { importHostBackedInteractiveDeferredDocument } = await import('@mog/kernel-host-internal');
  const result = await importHostBackedInteractiveDeferredDocument(
    hostResult.kernelContext,
    hostResult.bindings,
  );
  return result.handle;
}
