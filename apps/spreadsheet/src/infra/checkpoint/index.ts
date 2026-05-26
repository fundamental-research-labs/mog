/**
 * Checkpoint Module
 *
 * Local checkpoint management using Rust compute engine undo/redo.
 * Enables fast save/restore for AI agent operations.
 */

export { CheckpointManager } from './checkpoint-manager';
export type { Checkpoint, CreateCheckpointOptions, RestoreCheckpointOptions } from './types';
