/**
 * Scoped Undo API
 *
 * Creates a capability-gated wrapper around IUndoService.
 * Undo history is filtered by the app's read capabilities.
 */

import type { IUndoService } from '@mog-sdk/contracts/services';

import type { ScopedAPIContext } from './types';

/**
 * Create a scoped undo API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted undo service (may be undefined)
 * @param context - The scoped API context
 * @returns An undo service with restricted access, or undefined
 */
export function createScopedUndoAPI(
  fullApi: IUndoService | undefined,
  context: ScopedAPIContext,
): Partial<IUndoService> | undefined {
  if (!fullApi) {
    return undefined;
  }

  const hasRead = context.hasCapability('undo:read');
  const hasWrite = context.hasCapability('undo:write');

  // If no undo capabilities, return undefined
  if (!hasRead && !hasWrite) {
    return undefined;
  }

  const api: Partial<IUndoService> = {};

  // Read methods (require undo:read)
  if (hasRead) {
    api.canUndo = (): boolean => {
      return fullApi.canUndo();
    };

    api.canRedo = (): boolean => {
      return fullApi.canRedo();
    };

    // Note: getUndoStack and getRedoStack would need filtering based on
    // which resources the app can read. For now, we expose the basic
    // canUndo/canRedo checks.
  }

  // Write methods (require undo:write)
  if (hasWrite) {
    api.undo = () => {
      return fullApi.undo();
    };

    api.redo = () => {
      return fullApi.redo();
    };

    api.clear = (): void => {
      fullApi.clear();
    };
  }

  return api;
}
