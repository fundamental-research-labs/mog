/**
 * CellOverflowTooltip
 *
 * UI Micro-Polish - Overflow Tooltip
 *
 * Shows the full content of a clipped cell when hovering.
 * Excel displays this as a tooltip showing the complete cell text that was
 * truncated with an ellipsis.
 *
 * Migrated to use Popover primitive for positioning.
 *
 * Architecture:
 * - CellsLayer tracks clipped cells during render (clippedCells Map)
 * - Grid component detects mouse hover over cells
 * - Coordinator looks up clipped content from CellsLayer
 * - Tooltip shows full text near the cell after brief delay
 */

import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';

export interface CellOverflowTooltipProps {
  /** Full content of the clipped cell */
  content: string;
  /** Position of the tooltip (screen coordinates) */
  position: { x: number; y: number };
  /** Whether the tooltip is visible */
  visible: boolean;
}

/**
 * Cell overflow tooltip component.
 * Shows full cell content for clipped/ellipsis cells.
 * Uses a neutral light background (Excel-style).
 */
export function CellOverflowTooltip({ content, position, visible }: CellOverflowTooltipProps) {
  if (!content) return null;

  return (
    <Popover open={visible} onOpenChange={() => {}}>
      <PopoverAnchor virtualRef={{ current: createVirtualRef(position.x, position.y) }} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        shadow="md"
        rounded="default"
        closeOnClickOutside={false}
        closeOnEscape={false}
        closeOnScroll={false}
        width="auto"
        role="tooltip"
        aria-label="Cell content"
        className="px-2 py-1.5 pointer-events-none max-w-[400px] bg-ss-surface-primary border-ss-border-default text-body-sm text-text-ss-primary whitespace-pre-wrap break-words"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export default CellOverflowTooltip;
