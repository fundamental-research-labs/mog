/**
 * Kernel Context exports
 *
 * Single-factory architecture:
 * - createDocumentContext(): Creates the full DocumentContext
 * - Consumers declare minimum privilege via type narrowing:
 *   - IDomainContext (domain modules: event bus + undo only)
 *   - IKernelContext (shell: + all bridges + services)
 *   - DocumentContext (engine internals: + compute bridge + viewport)
 */

export { createEventBus } from './event-bus';
export {
  createDocumentContext,
  createKernelContext,
  type DocumentContext,
  type DocumentContextOptions,
  type IDomainContext,
  type IKernelContext,
  type ISlicerBridge,
  type ISpreadsheetKernelContext,
  type KernelClock,
} from './kernel-context';
export {
  projectPrincipal,
  projectAndVerifyPrincipal,
  PrincipalProjectionError,
  type PrincipalProjectionContext,
} from './principal-projection';
export {
  createHostPrincipalLock,
  HostPrincipalMutationError,
  type HostPrincipalLock,
} from './host-principal-lock';
export { installEvictionSink } from './bridge-devtools-wrapper';
