/**
 * Clipboard Service Module
 *
 * Cross-app clipboard service that survives app switches.
 * This is a kernel system service - the authoritative source for clipboard state.
 *
 */

export {
  clipboardServiceMachine,
  createClipboardService,
  getClipboardServiceSnapshot,
} from './clipboard-service';

export type {
  ClipboardServiceActor,
  ClipboardServiceMachine,
  ClipboardServiceState,
} from './clipboard-service';

export type {
  ClipboardContext,
  ClipboardEvent,
  ClipboardOperation,
  ClipboardPayload,
  ClipboardSnapshot,
  ClipboardState,
  IClipboardService,
} from './types';
