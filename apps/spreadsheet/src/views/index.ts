/**
 * View Infrastructure
 *
 * Exports all view infrastructure: types, registry, container component.
 * Views (Grid, Kanban, etc.) will be added in
 */

// Core types
export type {
  CalendarViewConfig,
  EditTarget,
  FormFieldConfig,
  FormViewConfig,
  GalleryViewConfig,
  GridViewConfig,
  KanbanViewConfig,
  ReactViewComponent,
  ReactViewProps,
  TableId,
  TimelineViewConfig,
  ToolbarContext,
  Unsubscribe,
  ViewAdapter,
  ViewAdapterConfig,
  ViewClipboardData,
  ViewConfig,
  ViewConfigBase,
  ViewDefinition,
  ViewId,
  ViewRenderingMode,
  ViewSelection,
  ViewType,
} from './types';

// Utility functions
export { getDefaultToolbarContext } from './types';

// Registry
export { VIEW_REGISTRY, ViewRegistry } from './registry';

// Container component
export { ViewContainer, ViewContainerById } from './container';
export type { ViewContainerByIdProps, ViewContainerProps } from './container';

// Hybrid container component (solves nested React root issue)
export { HybridViewContainer, HybridViewContainerById } from './HybridViewContainer';
export type { HybridViewContainerProps } from './HybridViewContainer';

// Register built-in views
import { calendarViewDefinition } from './calendar/definition';
import { formViewDefinition } from './form/definition';
import { galleryViewDefinition } from './gallery/definition';
import { gridViewDefinition } from './grid/definition';
import { kanbanViewDefinition } from './kanban/definition';
import { VIEW_REGISTRY } from './registry';
import { timelineViewDefinition } from './timeline/definition';

VIEW_REGISTRY.register(gridViewDefinition);
VIEW_REGISTRY.register(kanbanViewDefinition);
VIEW_REGISTRY.register(timelineViewDefinition);
VIEW_REGISTRY.register(calendarViewDefinition);
VIEW_REGISTRY.register(galleryViewDefinition);
VIEW_REGISTRY.register(formViewDefinition);

// View discovery system (F6)
export { getAllViews, getView, getViewsForTable, hasView } from './view-discovery';
export { ViewTabs } from './ViewTabs';
export type { ViewTabsProps } from './ViewTabs';

// Re-export views
export * from './calendar';
export * from './form';
export * from './gallery';
export * from './grid';
export * from './kanban';
export * from './timeline';
