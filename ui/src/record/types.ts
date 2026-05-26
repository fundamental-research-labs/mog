/**
 * Record Component Types
 *
 * Kernel-agnostic types for record components (RecordDetail, RecordCard, etc.).
 */

import type { ColumnInfo, UiCellValue, UIRecord } from '../types';

/**
 * RecordDetail props.
 */
export interface RecordDetailProps {
  /** Record to display/edit */
  record: UIRecord;
  /** Column definitions */
  columns: ColumnInfo[];
  /** Whether the detail panel is open */
  isOpen: boolean;
  /** Callback when panel should close */
  onClose: () => void;
  /** Callback when a field value changes */
  onFieldChange: (columnId: string, value: UiCellValue) => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * RecordCard props.
 */
export interface RecordCardProps {
  /** Record to display */
  record: UIRecord;
  /** Column definitions */
  columns: ColumnInfo[];
  /** Columns to display in the card (by ID) */
  displayColumns?: string[];
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Callback when card is clicked */
  onClick?: (recordId: string) => void;
  /** Optional CSS class name */
  className?: string;
}
