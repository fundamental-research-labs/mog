/**
 * Kanban View
 *
 * Exports for the Kanban view module.
 */

// Configuration
export { DEFAULT_KANBAN_CONFIG, createKanbanConfig, type KanbanViewConfig } from './config';

// View definition for registry
export { kanbanViewDefinition } from './definition';

// Adapter
export { KanbanViewAdapter, type KanbanViewAdapterConfig } from './KanbanViewAdapter';

// Main component
export { KanbanView, type KanbanViewProps } from './KanbanView';

// Container component (React tree rendering)
export { KanbanViewContainer, type KanbanViewContainerProps } from './KanbanViewContainer';

// State machine
export {
  KanbanEvents,
  getKanbanSnapshot,
  kanbanMachine,
  type KanbanActor,
  type KanbanContext,
  type KanbanEvent,
  type KanbanKeyModifiers,
  type KanbanMachine,
  type KanbanSnapshot,
  type KanbanState,
} from './machines';

// Components
export {
  AddCardButton,
  KanbanBoard,
  KanbanCard,
  KanbanCardEditor,
  KanbanColumn,
} from './components';

// Hooks
export { useCardDrag, useKanbanData, useKanbanDrag, useKanbanRecord } from './hooks';

// Utilities
export {
  findCard,
  findCardColumn,
  getAllCardIds,
  getNextCardId,
  groupRecordsByColumn,
  type GroupRecordsInput,
  type KanbanCard as KanbanCardData,
  type KanbanColumn as KanbanColumnData,
  type KanbanSelectOption,
} from './utils';
