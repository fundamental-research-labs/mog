/**
 * CellDisplay Component
 *
 * Generic cell display wrapper that uses the registry to render
 * the appropriate content based on column type.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import React from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import { getRenderer } from '../registry';
// =============================================================================
// Props
// =============================================================================

export interface CellDisplayProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines renderer) */
  column: ColumnSchema;
  /** Additional class name */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

// =============================================================================
// Component
// =============================================================================

/**
 * CellDisplay - Generic cell display wrapper.
 *
 * Uses the column renderer registry to display the appropriate
 * content based on the column type.
 *
 * Usage:
 * ```tsx
 * <CellDisplay
 * value={cell.value}
 * column={columnSchema}
 * />
 * ```
 */
export const CellDisplay: React.FC<CellDisplayProps> = ({
  value,
  column,
  className = '',
  style,
}) => {
  const renderer = getRenderer(column.kind);
  const content = renderer.render(value, column);

  return (
    <div
      className={`cell-display cell-display-${column.kind} overflow-hidden text-ellipsis whitespace-nowrap ${className}`}
      style={style}
    >
      {content}
    </div>
  );
};

// =============================================================================
// Card Field Wrapper
// =============================================================================

export interface CardFieldDisplayProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines renderer) */
  column: ColumnSchema;
  /** Compact mode */
  compact?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * CardFieldDisplay - Wrapper for card field display.
 *
 * Uses the cardField renderer if available, falls back to render().
 */
export const CardFieldDisplay: React.FC<CardFieldDisplayProps> = ({
  value,
  column,
  compact = false,
  className = '',
}) => {
  const renderer = getRenderer(column.kind);

  // Use cardField if available
  if (renderer.cardField) {
    const CardField = renderer.cardField;
    return <CardField value={value} column={column} compact={compact} className={className} />;
  }

  // Fall back to render()
  const content = renderer.render(value, column);

  return (
    <span className={`card-field-display card-field-${column.kind} ${className}`}>{content}</span>
  );
};

export default CellDisplay;
