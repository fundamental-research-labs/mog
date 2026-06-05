import type { DocumentHandle } from '@mog-sdk/kernel';
import { importStandaloneBrowserHostBackedInteractiveDocument } from '../../host-adapters/standalone-browser-host-backed-import';
import type { StandaloneBrowserShellResult } from '../../host-adapters/standalone-browser-host';

export async function importInteractiveHostBackedDocument(
  hostResult: StandaloneBrowserShellResult,
): Promise<DocumentHandle> {
  return importStandaloneBrowserHostBackedInteractiveDocument(hostResult);
}
