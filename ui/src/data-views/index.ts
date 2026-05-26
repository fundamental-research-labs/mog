/**
 * Data Views - Kernel-Agnostic View Components
 *
 * These components render data in different visualization formats.
 * They receive data as props with plain string IDs (not kernel types).
 *
 * Note: Import from specific subpaths for types to avoid conflicts:
 * - import type { KanbanState } from '@mog/ui/data-views/kanban'
 * - import type { TimelineState } from '@mog/ui/data-views/timeline'
 */

// Re-export only components, not utilities (which have naming conflicts)
export { Calendar, CalendarEvent, CalendarHeader, DayView, MonthGrid, WeekView } from './calendar';
export { Gallery, GalleryCard, GalleryGrid } from './gallery';
export { AddCardButton, KanbanBoard, KanbanCard, KanbanColumn } from './kanban';
export { Timeline, TimelineAxis, TimelineBar } from './timeline';
