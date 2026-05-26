/**
 * Undo Service Module
 *
 * Delegates undo/redo to Rust compute engine via ComputeBridge.
 *
 */

export { createUndoService, type IUndoReplayService } from './undo-service';

export type {
  IUndoService,
  UndoError,
  UndoServiceState,
  UndoStackItem,
  UndoStateChangeEvent,
} from './types';
