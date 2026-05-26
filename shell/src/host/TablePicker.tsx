/**
 * TablePicker - Component to select an existing table for app binding
 *
 * Displays a dropdown of available tables in the workbook.
 * Used in the app binding flow when user chooses "Use existing data".
 *
 */

import type { AppTableInfo } from '@mog-sdk/contracts/apps';

import { Label } from '../components/ui/Label';
import { Select } from '../components/ui/Select';

// =============================================================================
// Types
// =============================================================================

export interface TablePickerProps {
  /** Label text for the picker (e.g., "Deals table") */
  label: string;
  /** Available tables to choose from */
  tables: AppTableInfo[];
  /** Currently selected table ID (null if none selected) */
  selectedTableId: string | null;
  /** Called when a table is selected */
  onSelect: (tableId: string) => void;
  /** Whether the field is required */
  required?: boolean;
  /** Optional description/help text */
  description?: string;
  /** Additional class names */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * TablePicker - Dropdown for selecting a table from the workbook.
 *
 * Shows table name and column count for each option to help users
 * identify the correct table.
 *
 * @example
 * ```tsx
 * <TablePicker
 *   label="Deals table"
 *   tables={availableTables}
 *   selectedTableId={selectedDealsTableId}
 *   onSelect={(tableId) => setSelectedDealsTableId(tableId)}
 *   required
 * />
 * ```
 */
export function TablePicker({
  label,
  tables,
  selectedTableId,
  onSelect,
  required = false,
  description,
  className = '',
}: TablePickerProps) {
  const options = tables.map((table) => ({
    value: table.id,
    label: `${table.name} (${table.columns.length} columns)`,
  }));

  return (
    <div className={`mb-4 ${className}`}>
      <Label required={required}>{label}</Label>
      {description && <p className="text-caption text-ss-text-tertiary mb-2">{description}</p>}
      <Select
        options={options}
        value={selectedTableId ?? ''}
        onChange={(value) => onSelect(value)}
        placeholder="Select a table..."
      />
      {selectedTableId && <TablePreview table={tables.find((t) => t.id === selectedTableId)} />}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface TablePreviewProps {
  table: AppTableInfo | undefined;
}

/**
 * TablePreview - Shows a preview of the selected table's columns.
 */
function TablePreview({ table }: TablePreviewProps) {
  if (!table) return null;

  return (
    <div className="mt-2 p-3 bg-ss-surface-secondary rounded-ss-md border border-ss-border-light">
      <p className="text-caption font-medium text-ss-text-secondary mb-2">
        Columns in {table.name}:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {table.columns.map((col) => (
          <span
            key={col.id}
            className="px-2 py-0.5 text-caption bg-ss-surface rounded border border-ss-border text-ss-text-secondary"
          >
            {col.name}
          </span>
        ))}
      </div>
    </div>
  );
}
