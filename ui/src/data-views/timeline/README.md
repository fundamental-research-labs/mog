# Timeline Data View

A kernel-agnostic Gantt-style timeline component for visualizing time-based data.

## Overview

The Timeline component is a fully self-contained React component that displays data as horizontal bars on a time axis. It's kernel-agnostic, meaning it has no dependencies on `@mog/kernel` or kernel-specific types like `RowId`, `ColId`, etc.

## Features

- **Gantt-style visualization**: Horizontal bars representing time ranges
- **Interactive**: Click, drag to move, drag edges to resize
- **Grouping**: Optional grouping with collapsible sections
- **Milestones**: Single-point-in-time events (rendered as diamonds)
- **Time scales**: Day, week, month, quarter, year
- **Today marker**: Visual indicator for current date
- **Weekend highlighting**: Optional shading for weekends
- **Keyboard-agnostic**: All IDs are plain strings

## Usage

```tsx
import { Timeline, TimelineState, TimelineBar } from '@mog/ui/data-views/timeline';

// Define your bars
const bars: TimelineBar[] = [
  {
    id: 'task-1',
    title: 'Design Phase',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-15'),
    color: '#4A90D9',
    groupId: 'project-a'
  },
  {
    id: 'task-2',
    title: 'Development',
    startDate: new Date('2024-01-16'),
    endDate: new Date('2024-02-15'),
    color: '#67B26F',
    groupId: 'project-a'
  },
  {
    id: 'milestone-1',
    title: 'Launch',
    startDate: new Date('2024-02-20'),
    endDate: new Date('2024-02-20'),
    color: '#FF6B6B',
    isMilestone: true
  }
];

// Define groups (optional)
const groups = [
  {
    id: 'project-a',
    label: 'Project A',
    bars: []
  }
];

// Define state
const [state, setState] = useState<TimelineState>({
  selection: {
    selectedBarIds: new Set(),
    focusedBarId: null
  },
  viewport: {
    scrollLeft: 0,
    scrollTop: 0,
    scale: 'day',
    viewportStart: new Date('2024-01-01'),
    viewportEnd: new Date('2024-03-01')
  },
  dragState: null,
  collapsedGroups: new Set()
});

// Render timeline
<Timeline
  bars={bars}
  groups={groups}
  state={state}
  handlers={{
    onBarClick: (barId, event) => {
      console.log('Bar clicked:', barId);
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          selectedBarIds: new Set([barId])
        }
      }));
    },
    onBarDoubleClick: (barId) => {
      console.log('Bar double-clicked:', barId);
    },
    onBarDrag: (barId, newStartDate, newEndDate) => {
      console.log('Bar dragged:', barId, newStartDate, newEndDate);
      // Update your data source
    },
    onBarResize: (barId, newStartDate, newEndDate) => {
      console.log('Bar resized:', barId, newStartDate, newEndDate);
      // Update your data source
    },
    onGroupToggle: (groupId, collapsed) => {
      setState((prev) => {
        const newCollapsed = new Set(prev.collapsedGroups);
        if (collapsed) {
          newCollapsed.add(groupId);
        } else {
          newCollapsed.delete(groupId);
        }
        return {
          ...prev,
          collapsedGroups: newCollapsed
        };
      });
    }
  }}
  config={{
    rowHeight: 40,
    labelColumnWidth: 200,
    showTodayMarker: true,
    showWeekends: true
  }}
/>;
```

## Components

### Timeline (Main Component)

The main timeline component that orchestrates all sub-components.

**Props:**

- `bars: TimelineBar[]` - Array of bars to display
- `groups?: TimelineGroup[]` - Optional groups for organizing bars
- `state: TimelineState` - Current state (selection, viewport, drag, etc.)
- `config?: Partial<TimelineConfig>` - Configuration options
- `handlers?: TimelineEventHandlers` - Event callbacks
- `className?: string` - Optional CSS class
- `style?: React.CSSProperties` - Optional inline styles

### TimelineBar

Individual bar component (used internally by Timeline).

**Features:**

- Visual feedback for selection/focus
- Hover effects
- Resize handles on selected bars
- Drag support
- Milestone rendering (diamond shape)

### TimelineAxis

Time axis header showing date labels.

**Features:**

- Configurable scales (day/week/month/quarter/year)
- Today marker
- Weekend highlighting
- Minor/major label styling

## Types

### TimelineBar

```typescript
interface TimelineBar {
  id: string; // Unique identifier (plain string)
  title: string; // Display title
  startDate: Date; // Start date
  endDate: Date; // End date (same as start for milestones)
  color: string; // CSS color
  groupId?: string; // Optional group ID
  isMilestone?: boolean; // Single point in time
  dependencies?: string[]; // IDs of dependencies
}
```

### TimelineGroup

```typescript
interface TimelineGroup {
  id: string; // Unique identifier
  label: string; // Display label
  bars: TimelineBar[]; // Bars in this group
  collapsed?: boolean; // Collapsed state
}
```

### TimelineState

```typescript
interface TimelineState {
  selection: {
    selectedBarIds: Set<string>;
    focusedBarId: string | null;
  };
  viewport: {
    scrollLeft: number;
    scrollTop: number;
    scale: TimelineScale;
    viewportStart: Date;
    viewportEnd: Date;
  };
  dragState: TimelineDragState | null;
  collapsedGroups: Set<string>;
}
```

### TimelineScale

```typescript
type TimelineScale = 'day' | 'week' | 'month' | 'quarter' | 'year';
```

## Utilities

### Date Utilities

```typescript
// Convert date to pixels
dateToPixels(date: Date, timelineStart: Date, scale: TimelineScale): number

// Convert pixels to date
pixelsToDate(pixels: number, timelineStart: Date, scale: TimelineScale): Date

// Snap date to unit boundary
snapToUnit(date: Date, scale: TimelineScale): Date

// Get next unit boundary
getNextUnit(date: Date, scale: TimelineScale): Date

// Generate axis labels
generateAxisLabels(startDate: Date, endDate: Date, scale: TimelineScale, timelineStart: Date): TimelineAxisLabel[]

// Calculate date range from data
calculateDateRange(dates: Date[], scale: TimelineScale, padding?: number): { start: Date; end: Date }

// Get date range from bars
getDateRange(bars: Array<{ startDate: Date; endDate: Date }>): { minDate: Date; maxDate: Date } | null
```

## Configuration

Default configuration values:

```typescript
{
  rowHeight: 40,              // Height of each row in pixels
  barPadding: 4,              // Padding around bars
  groupHeaderHeight: 32,      // Height of group headers
  labelColumnWidth: 200,      // Width of label column
  showTodayMarker: true,      // Show today indicator
  showWeekends: true,         // Shade weekends
  minBarWidth: 4              // Minimum bar width for visibility
}
```

## Integration with Kernel

To integrate with the kernel (in shell/src/views/timeline/):

1. Create a `TimelineViewAdapter` that implements `IViewAdapter`
2. Fetch data from kernel stores and transform to plain objects:
   - `RowId` → `string` (use `rowId.toString()` or similar)
   - Kernel date types → `Date`
   - Kernel colors → CSS color strings
3. Pass transformed data to the `Timeline` component
4. Handle events from Timeline and update kernel stores

Example adapter pattern:

```typescript
// In shell/src/views/timeline/TimelineViewAdapter.ts
class TimelineViewAdapter implements IViewAdapter {
  render() {
    // 1. Fetch data from kernel stores
    const records = this.store.getRecords();

    // 2. Transform to plain objects
    const bars: TimelineBar[] = records.map(record => ({
      id: record.id.toString(),  // RowId → string
      title: record.getTitle(),
      startDate: record.getStartDate(),
      endDate: record.getEndDate(),
      color: record.getColor(),
      groupId: record.getGroupId()?.toString()
    }));

    // 3. Render Timeline component
    return (
      <Timeline
        bars={bars}
        state={this.state}
        handlers={{
          onBarDrag: (id, start, end) => {
            // Update kernel store
            const rowId = RowId.fromString(id);
            this.store.updateRecord(rowId, { startDate: start, endDate: end });
          }
        }}
      />
    );
  }
}
```

## Architecture

The timeline is built with:

- **React components** (not canvas-based for the UI layer)
- **Absolute positioning** for bars within rows
- **CSS transforms** for smooth scrolling
- **Event delegation** for efficient interaction handling
- **Pure functions** for date calculations

This design makes it:

- Easy to test
- Accessible (DOM-based, not canvas)
- Flexible (CSS styling)
- Performant (optimized renders)
- Portable (no kernel dependencies)
