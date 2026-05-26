/**
 * Scoped Clipboard API
 *
 * Creates a capability-gated wrapper around IAppClipboardAPI.
 * Note: clipboard:read and clipboard:write are INDEPENDENT capabilities.
 */

import type {
  AppClipboardPayload,
  AppClipboardSnapshot,
  IAppClipboardAPI,
  Unsubscribe,
} from '@mog-sdk/contracts/apps';

import type { ScopedAPIContext } from './types';

/**
 * Create a scoped clipboard API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted clipboard API (may be undefined)
 * @param context - The scoped API context
 * @returns A clipboard API with restricted access, or undefined
 */
export function createScopedClipboardAPI(
  fullApi: IAppClipboardAPI | undefined,
  context: ScopedAPIContext,
): Partial<IAppClipboardAPI> | undefined {
  if (!fullApi) {
    return undefined;
  }

  const hasRead = context.hasCapability('clipboard:read');
  const hasWrite = context.hasCapability('clipboard:write');

  // If no clipboard capabilities, return undefined
  if (!hasRead && !hasWrite) {
    return undefined;
  }

  const api: Partial<IAppClipboardAPI> = {};

  // Read methods (require clipboard:read)
  if (hasRead) {
    api.getSnapshot = (): AppClipboardSnapshot => {
      return fullApi.getSnapshot();
    };

    api.getPayload = (): AppClipboardPayload | null => {
      return fullApi.getPayload();
    };

    api.subscribe = (handler: (snapshot: AppClipboardSnapshot) => void): Unsubscribe => {
      return fullApi.subscribe(handler);
    };
  }

  // Write methods (require clipboard:write)
  if (hasWrite) {
    api.copy = (payload: AppClipboardPayload): void => {
      fullApi.copy(payload);
    };

    api.cut = (payload: AppClipboardPayload): void => {
      fullApi.cut(payload);
    };

    api.clear = (): void => {
      fullApi.clear();
    };
  }

  return api;
}
