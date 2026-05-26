/**
 * Drag-Drop Feature Module
 *
 * Exports the DragDropCoordinator for wiring cell drag-drop operations.
 *
 * @see drag-drop-coordination.ts for implementation details
 */

export {
  DragDropCoordinator,
  createDragDropCoordinator,
  isValidDropTarget,
  type DragDropCoordinatorDependencies,
  type DragDropResult,
} from './drag-drop-coordination';
