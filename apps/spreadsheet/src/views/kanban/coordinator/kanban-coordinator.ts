/**
 * KanbanCoordinator
 *
 * Owns the Kanban state machine and coordinates all side effects.
 * Follows the coordinator pattern from ARCHITECTURE-CHECKLIST.md:
 * - Machine ownership: Creates and owns the KanbanActor
 * - Transition detection: Uses previousState in subscriptions
 * - Kernel integration: Handles data mutations through Kernel API
 *
 * Key responsibilities:
 * - Owns the state machine lifecycle (start/stop)
 * - Detects state transitions and triggers appropriate side effects
 * - Handles data mutations via Kernel.Records API
 * - Provides cleanup for subscriptions
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { createActor, type SnapshotFrom } from 'xstate';
import type { TableId } from '../../types';
import type { KanbanViewConfig } from '../config';
import { getKanbanSnapshot, KanbanEvents, kanbanMachine, type KanbanActor } from '../machines';

// =============================================================================
// Types
// =============================================================================

export interface KanbanCoordinationConfig {
  /** Workbook API for data access */
  workbook: Workbook;
  /** Table ID for record operations */
  tableId: TableId;
  /** Kanban view configuration */
  config: KanbanViewConfig;
}

export interface KanbanCoordinationResult {
  /** The state machine actor */
  actor: KanbanActor;
  /** Cleanup function to stop actor and unsubscribe */
  cleanup: () => void;
}

// =============================================================================
// Coordinator Setup
// =============================================================================

/**
 * Setup Kanban coordination with transition detection.
 *
 * This function:
 * 1. Creates and starts the state machine actor
 * 2. Subscribes to state changes with transition detection
 * 3. Triggers Kernel mutations on appropriate transitions
 * 4. Returns cleanup function for proper disposal
 *
 * @example
 * ```typescript
 * const { actor, cleanup } = setupKanbanCoordination({ ctx, tableId, config });
 *
 * // Use actor in React components via useSelector
 * const snapshot = useSelector(actor, getKanbanSnapshot);
 *
 * // Cleanup on unmount
 * cleanup();
 * ```
 */
export function setupKanbanCoordination(
  coordinationConfig: KanbanCoordinationConfig,
): KanbanCoordinationResult {
  const { workbook, tableId, config } = coordinationConfig;

  // Create and start the state machine actor
  const actor = createActor(kanbanMachine);
  actor.start();

  // Track previous state for transition detection
  let previousState: SnapshotFrom<typeof kanbanMachine> | null = null;

  // Subscribe to state changes with transition detection
  const subscription = actor.subscribe((state) => {
    // =========================================================================
    // TRANSITION DETECTION PATTERN
    // Detect state TRANSITIONS, not just current state
    // =========================================================================

    // Transition: dragging -> selecting (via DROP event)
    // This means a card was dropped - persist the move
    if (
      previousState?.matches('dragging') &&
      !state.matches('dragging') &&
      previousState.context.dropPosition
    ) {
      const { draggedCard, dropPosition } = previousState.context;
      if (draggedCard && dropPosition) {
        // Persist the card move via Workbook Records API
        void workbook.records.update(tableId, draggedCard, {
          [config.groupByColumn]: dropPosition.column as CellValue,
        });
      }
    }

    // Transition: editing -> selecting (via COMMIT_EDIT event)
    // Note: Edit value is passed via the adapter's handleCardEdit callback
    // The coordinator doesn't have access to the edited value directly
    // So edit commits are handled by the adapter before sending COMMIT_EDIT

    // Transition: adding -> idle (via COMMIT_ADD_CARD event)
    // Note: New card data is passed via the adapter's handleCardCreate callback
    // The coordinator doesn't have access to the new card data directly
    // So card creation is handled by the adapter before sending COMMIT_ADD_CARD

    // Update previous state for next comparison
    previousState = state;
  });

  // Return actor and cleanup function
  return {
    actor,
    cleanup: () => {
      subscription.unsubscribe();
      actor.stop();
    },
  };
}

// =============================================================================
// Coordinator Class (Alternative API)
// =============================================================================

/**
 * KanbanCoordinator class for object-oriented usage.
 *
 * This provides an alternative to the functional setupKanbanCoordination API,
 * useful when you need instance methods for complex coordination scenarios.
 */
export class KanbanCoordinator {
  private readonly workbook: Workbook;
  private readonly tableId: TableId;
  private readonly config: KanbanViewConfig;
  private readonly actor: KanbanActor;
  private previousState: SnapshotFrom<typeof kanbanMachine> | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  constructor(coordinationConfig: KanbanCoordinationConfig) {
    this.workbook = coordinationConfig.workbook;
    this.tableId = coordinationConfig.tableId;
    this.config = coordinationConfig.config;

    // Create and start the state machine actor
    this.actor = createActor(kanbanMachine);
    this.actor.start();

    // Set up transition detection subscription
    this.subscription = this.actor.subscribe((state) => {
      this.handleStateTransition(state);
    });
  }

  /**
   * Get the state machine actor for React integration.
   */
  getActor(): KanbanActor {
    return this.actor;
  }

  /**
   * Handle card move (called by adapter when drop completes).
   * Persists the move via Kernel.Records API.
   */
  handleCardMove(cardId: RowId, newGroupValue: string, _index: number): void {
    void this.workbook.records.update(this.tableId, cardId, {
      [this.config.groupByColumn]: newGroupValue as CellValue,
    });
    // TODO: Handle index-based ordering when order column is configured
  }

  /**
   * Handle card edit (called by adapter when edit commits).
   * Persists the edit via Kernel.Records API.
   */
  handleCardEdit(cardId: RowId, fieldId: ColId | null, value: CellValue): void {
    const field = fieldId || this.config.cardTitleColumn;
    void this.workbook.records.update(this.tableId, cardId, {
      [field]: value,
    });
  }

  /**
   * Handle card create (called by adapter when add commits).
   * Creates a new record via Kernel.Records API.
   */
  handleCardCreate(groupValue: string, title: string): void {
    void this.workbook.records.create(this.tableId, {
      [this.config.cardTitleColumn]: title,
      [this.config.groupByColumn]: groupValue as CellValue,
    });
  }

  /**
   * Handle cards delete (called by adapter when delete is triggered).
   * Deletes records via Kernel.Records API.
   */
  handleCardsDelete(cardIds: RowId[]): void {
    for (const cardId of cardIds) {
      void this.workbook.records.remove(this.tableId, cardId);
    }
  }

  /**
   * Internal: Handle state transitions with side effects.
   */
  private handleStateTransition(state: SnapshotFrom<typeof kanbanMachine>): void {
    // Transition: dragging -> * (any state after dragging)
    // If we have drop position, the drop was successful
    if (
      this.previousState?.matches('dragging') &&
      !state.matches('dragging') &&
      this.previousState.context.dropPosition
    ) {
      const { draggedCard, dropPosition } = this.previousState.context;
      if (draggedCard && dropPosition) {
        // Note: The actual Kernel mutation is now handled via handleCardMove
        // This transition detection is kept for potential future side effects
        // like analytics, undo stack registration, etc.
      }
    }

    this.previousState = state;
  }

  /**
   * Cleanup all resources.
   * Call this when the Kanban view is being disposed.
   */
  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.actor.stop();
  }
}

// =============================================================================
// Exports
// =============================================================================

export { getKanbanSnapshot, KanbanEvents, type KanbanActor };
