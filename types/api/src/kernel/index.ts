/**
 * Kernel Types
 *
 * Three-tier context architecture:
 * - IDomainContext: Minimal (for domain modules — event bus + undo)
 * - IKernelContext: Full (for Shell, includes all bridges + services + destroy)
 * - DocumentContext: Engine internals (defined in kernel, not contracts)
 */

export type {
  IDomainContext,
  IKernelContext,
  ISlicerBridge,
  ISpreadsheetKernelContext,
} from './kernel-context';

export type { IFloatingObjectManager, ObjectBounds } from './floating-object-manager';

// Re-export IKernelServices from services for convenience
export type { IKernelServices } from '../services';
