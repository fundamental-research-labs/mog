/**
 * Renderer Actions
 *
 * Functions for renderer lifecycle management and renderer-related actions.
 *
 */

import type { ActorManager } from '../shared/actor-manager';
import type { PendingAction } from '../shared/types';

// =============================================================================
// RENDERER MACHINE EVENTS
// =============================================================================

/**
 * Mount the renderer to a container element.
 */
export function mountRendererAction(actors: ActorManager, container: HTMLElement): void {
  actors.renderer.send({ type: 'MOUNT', container });
}

/**
 * Signal layout is ready with dimensions.
 */
export function layoutReadyAction(actors: ActorManager, width: number, height: number): void {
  actors.renderer.send({ type: 'LAYOUT_READY', width, height });
}

/**
 * Signal renderer initialized for a sheet.
 */
export function rendererInitializedAction(actors: ActorManager, sheetId: string): void {
  actors.renderer.send({ type: 'INITIALIZED', sheetId });
}

/**
 * Switch to a different sheet.
 */
export function switchSheetAction(actors: ActorManager, sheetId: string): void {
  actors.renderer.send({ type: 'SWITCH_SHEET', sheetId });
}

/**
 * Signal sheet switch complete.
 */
export function sheetSwitchedAction(actors: ActorManager): void {
  actors.renderer.send({ type: 'SHEET_SWITCHED' });
}

/**
 * Suspend the renderer.
 */
export function suspendRendererAction(actors: ActorManager): void {
  actors.renderer.send({ type: 'SUSPEND' });
}

/**
 * Resume the renderer.
 */
export function resumeRendererAction(actors: ActorManager): void {
  actors.renderer.send({ type: 'RESUME' });
}

/**
 * Unmount the renderer.
 */
export function unmountRendererAction(actors: ActorManager): void {
  actors.renderer.send({ type: 'UNMOUNT' });
}

/**
 * Queue an action for when renderer is ready.
 */
export function queueRendererActionAction(actors: ActorManager, action: PendingAction): void {
  actors.renderer.send({ type: 'QUEUE_ACTION', action });
}
