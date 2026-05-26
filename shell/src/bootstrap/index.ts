/**
 * Shell Bootstrap Module
 *
 * Exports the shell bootstrap functionality for use by the app entry point.
 *
 * Usage:
 * ```ts
 * import { createShell, type ShellBootstrapResult } from '@mog/shell/bootstrap';
 *
 * // Bootstrap BEFORE React
 * const shell = await createShell();
 * await shell.eventDispatcher.start();
 *
 * // Pass to React
 * <ShellProvider shell={shell}>...</ShellProvider>
 * ```
 */

export { createShell } from './create-shell';
export { createEventDispatcher } from './event-dispatcher';
export type { EventDispatcher, EventDispatcherDeps, ShellEventHandlers } from './dispatcher-types';
export type {
  ShellBootstrapCapabilityRegistry,
  ShellBootstrapConfig,
  ShellBootstrapResult,
} from './types';
