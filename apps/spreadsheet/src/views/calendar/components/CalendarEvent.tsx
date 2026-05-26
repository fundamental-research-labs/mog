/**
 * CalendarEvent Component
 *
 * Renders a single event in the calendar. Used in month, week, and day views.
 * Supports drag-to-reschedule functionality.
 * Uses column renderers for consistent event title rendering across views.
 */

import React, { useCallback } from 'react';
import { CardFieldDisplay } from '../../../components/column-renderers';
import type { CalendarEvent as CalendarEventType } from '../config';

// =============================================================================
// Types
// =============================================================================

interface CalendarEventProps {
  /** The event data */
  event: CalendarEventType;
  /** Is this event selected? */
  isSelected: boolean;
  /** Is this event being dragged? */
  isDragging: boolean;
  /** Display variant */
  variant?: 'compact' | 'full';
  /** Click handler */
  onClick?: (event: CalendarEventType, e: React.MouseEvent) => void;
  /** Double-click handler */
  onDoubleClick?: (event: CalendarEventType) => void;
  /** Drag start handler */
  onDragStart?: (event: CalendarEventType) => void;
  /** Custom style overrides */
  style?: React.CSSProperties;
}

// =============================================================================
// Default styles - Using Tailwind classes where possible
// Inline styles still needed for dynamic colors
// =============================================================================

const baseClasses =
  'rounded-ss-sm text-caption leading-tight cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap transition-all';
const selectedClasses = 'ring-2 ring-ss-primary/50';
const draggingClasses = 'opacity-50 shadow-ss-md';
const compactClasses = 'px-1 py-0.5 text-hint';
const fullClasses = 'px-2 py-1 whitespace-normal';

// =============================================================================
// Component
// =============================================================================

export function CalendarEventComponent({
  event,
  isSelected,
  isDragging,
  variant = 'compact',
  onClick,
  onDoubleClick,
  onDragStart,
  style,
}: CalendarEventProps): React.ReactElement {
  // Event handlers
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.(event, e);
    },
    [event, onClick],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick?.(event);
    },
    [event, onDoubleClick],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', event.rowId);
      e.dataTransfer.effectAllowed = 'move';
      onDragStart?.(event);
    },
    [event, onDragStart],
  );

  // Compute styles - backgroundColor and color must remain inline for dynamic values
  const backgroundColor = event.color || 'var(--color-ss-primary)';
  // Fallback hex #217346 corresponds to --color-ss-primary design token
  const textColor = getContrastColor(event.color || '#217346');

  const variantClasses = variant === 'compact' ? compactClasses : fullClasses;
  const stateClasses = [isSelected ? selectedClasses : '', isDragging ? draggingClasses : '']
    .filter(Boolean)
    .join(' ');

  // Render title using column renderer if available, otherwise plain text
  const renderTitle = () => {
    if (event.titleColumn && event.titleValue !== undefined) {
      return (
        <CardFieldDisplay
          value={event.titleValue}
          column={event.titleColumn}
          compact={variant === 'compact'}
        />
      );
    }
    return event.title;
  };

  return (
    <div
      className={`calendar-event ${baseClasses} ${variantClasses} ${stateClasses}`}
      style={{ backgroundColor, color: textColor, ...style }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      draggable
      onDragStart={handleDragStart}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={event.title}
    >
      {renderTitle()}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get contrasting text color (black or white) for a background color.
 */
function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // #000000 = --color-ss-text, #ffffff = --color-ss-text-inverse
  // Hex values used here because this function operates on raw hex color strings
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Re-export with more common name
export { CalendarEventComponent as CalendarEvent };
