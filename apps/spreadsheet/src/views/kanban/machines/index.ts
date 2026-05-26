/**
 * Kanban Machines
 *
 * State machines for the Kanban view.
 */

export {
  KanbanEvents,
  getKanbanSnapshot,
  kanbanMachine,
  type KanbanActor,
  type KanbanContext,
  type KanbanEvent,
  type KanbanMachine,
  type KanbanSnapshot,
  type KanbanState,
  type KeyModifiers,
} from './kanban-machine';

// Also export with Kanban prefix for external use (avoids conflicts with timeline)
export type { KeyModifiers as KanbanKeyModifiers } from './kanban-machine';
