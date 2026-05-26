/**
 * Shared helper for getting the SpreadsheetObjectManager instance.
 * Used by floating-object-operations, shape-operations, equation-operations,
 * drawing-operations, text-effects-operations, and diagram-operations.
 */

import type { DocumentContext } from '../types';

/**
 * Get the document-scoped floating object manager from context.
 * Returns the singleton created during document lifecycle initialization.
 */
export function getFloatingObjectManager(ctx: DocumentContext) {
  return ctx.floatingObjectManager;
}
