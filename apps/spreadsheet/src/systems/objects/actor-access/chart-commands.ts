/**
 * Chart Command Factory
 *
 * Type-safe wrappers around actor.send() for chart state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/objects/actor-access/chart-commands
 */

import type {
  ChartCommands,
  ChartElementType,
  ChartType,
  ResizeHandle,
} from '@mog-sdk/contracts/actors';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create chart commands from a chart actor.
 * Wraps actor.send() with type-safe methods for chart events.
 *
 * @param actor - The chart state machine actor
 * @returns ChartCommands interface implementation
 *
 * @see state-machines/src/chart-machine.ts for event definitions
 */
export function createChartCommands(actor: MinimalActor): ChartCommands {
  return {
    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------
    select: (chartId: string) => actor.send({ type: 'SELECT', chartId }),

    deselect: () => actor.send({ type: 'DESELECT' }),

    deselectAll: () => actor.send({ type: 'DESELECT_ALL' }),

    addToSelection: (chartId: string) => actor.send({ type: 'ADD_TO_SELECTION', chartId }),

    toggleSelection: (chartId: string) => actor.send({ type: 'TOGGLE_SELECTION', chartId }),

    // -------------------------------------------------------------------------
    // Editing
    // -------------------------------------------------------------------------
    startEdit: () => actor.send({ type: 'START_EDIT' }),

    stopEdit: () => actor.send({ type: 'STOP_EDIT' }),

    // -------------------------------------------------------------------------
    // Creation Wizard
    // -------------------------------------------------------------------------
    create: (initialDataRange?: string) => actor.send({ type: 'CREATE', initialDataRange }),

    setType: (chartType: ChartType) => actor.send({ type: 'SET_TYPE', chartType }),

    setDataRange: (dataRange: string) => actor.send({ type: 'SET_DATA_RANGE', dataRange }),

    nextStep: () => actor.send({ type: 'NEXT_STEP' }),

    prevStep: () => actor.send({ type: 'PREV_STEP' }),

    cancel: () => actor.send({ type: 'CANCEL' }),

    confirm: () => actor.send({ type: 'CONFIRM' }),

    // -------------------------------------------------------------------------
    // Deletion
    // -------------------------------------------------------------------------
    delete: () => actor.send({ type: 'DELETE' }),

    // -------------------------------------------------------------------------
    // Drag/Resize
    // -------------------------------------------------------------------------
    pointerDownBody: (pointerId: number, clientX: number, clientY: number) =>
      actor.send({ type: 'POINTER_DOWN_BODY', pointerId, clientX, clientY }),

    pointerDownHandle: (
      pointerId: number,
      clientX: number,
      clientY: number,
      handle: ResizeHandle,
      shiftKey?: boolean,
      ctrlKey?: boolean,
      originalWidth?: number,
      originalHeight?: number,
    ) =>
      actor.send({
        type: 'POINTER_DOWN_HANDLE',
        pointerId,
        clientX,
        clientY,
        handle,
        shiftKey,
        ctrlKey,
        originalWidth,
        originalHeight,
      }),

    pointerMove: (clientX: number, clientY: number, shiftKey?: boolean, ctrlKey?: boolean) =>
      actor.send({ type: 'POINTER_MOVE', clientX, clientY, shiftKey, ctrlKey }),

    pointerUp: () => actor.send({ type: 'POINTER_UP' }),

    reset: () => actor.send({ type: 'RESET' }),

    updateModifiers: (shiftKey: boolean, ctrlKey: boolean) =>
      actor.send({ type: 'UPDATE_MODIFIERS', shiftKey, ctrlKey }),

    // -------------------------------------------------------------------------
    // Element Selection
    // -------------------------------------------------------------------------
    clickElement: (elementType: ChartElementType) =>
      actor.send({ type: 'CLICK_ELEMENT', elementType }),

    doubleClick: (elementType?: ChartElementType) =>
      actor.send({ type: 'DOUBLE_CLICK', elementType }),

    clickSeries: (seriesIndex: number) => actor.send({ type: 'CLICK_SERIES', seriesIndex }),

    clickPoint: (seriesIndex: number, pointIndex: number) =>
      actor.send({ type: 'CLICK_POINT', seriesIndex, pointIndex }),

    startTitleEdit: (originalValue: string) =>
      actor.send({ type: 'START_TITLE_EDIT', originalValue }),

    endTitleEdit: () => actor.send({ type: 'END_TITLE_EDIT' }),

    cancelTitleEdit: () => actor.send({ type: 'CANCEL_TITLE_EDIT' }),

    clearElementSelection: () => actor.send({ type: 'CLEAR_ELEMENT_SELECTION' }),

    // -------------------------------------------------------------------------
    // External Events
    // -------------------------------------------------------------------------
    sheetSwitched: () => actor.send({ type: 'SHEET_SWITCHED' }),

    remoteChartDeleted: (chartId: string) => actor.send({ type: 'REMOTE_CHART_DELETED', chartId }),

    externalSelectionActive: (context: 'cells' | 'objects' | 'chart') =>
      actor.send({ type: 'EXTERNAL_SELECTION_ACTIVE', context }),
  };
}
