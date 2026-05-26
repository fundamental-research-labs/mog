/**
 * UI Package Main Export
 *
 * Kernel-agnostic UI components for building spreadsheet interfaces.
 *
 * Import patterns:
 * - import { KanbanBoard } from '@mog/ui'
 * - import { KanbanBoard } from '@mog/ui/data-views/kanban'
 * - import type { KanbanState } from '@mog/ui/data-views/kanban'
 */

// Base types
export type {
  BaseDataViewProps,
  CellError,
  CellValueOrError,
  ColumnInfo,
  ColumnTypeKind,
  DragState,
  Filter,
  FilterCondition,
  FilterOperator,
  KeyModifiers,
  SelectionState,
  SortConfig,
  SortDirection,
  UIRecord,
  UiCellValue,
} from './types';

// SelectOption is defined in both types.ts and fields/types.ts
// Export the base one here, fields package exports its own
export type { SelectOption } from './types';

// Form Fields - export components only, types via subpath
export {
  CheckboxField,
  DateField,
  NumberField,
  PersonField,
  SelectField,
  TextField,
} from './fields';

// Table Components
export { FilterBar, SortMenu } from './table';

// Record Components
export { RecordCard, RecordDetail } from './record';

// Data View Components - export components only
// Types should be imported from subpaths to avoid conflicts
export {
  Calendar,
  CalendarEvent,
  CalendarHeader,
  DayView,
  MonthGrid,
  WeekView,
} from './data-views/calendar';
export { Gallery, GalleryCard, GalleryGrid } from './data-views/gallery';
export { AddCardButton, KanbanBoard, KanbanCard, KanbanColumn } from './data-views/kanban';
export { Timeline, TimelineAxis, TimelineBar } from './data-views/timeline';
