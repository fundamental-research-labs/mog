/**
 * ColumnMapper - Component to map app logical columns to actual table columns
 *
 * Shows a mapping UI where each app-defined column can be mapped to
 * an actual column in the selected table.
 *
 */

import type { AppColumnInfo, AppColumnSchema, ColumnMapping } from '@mog-sdk/contracts/apps';

import { Label } from '../components/ui/Label';
import { Select } from '../components/ui/Select';

// =============================================================================
// Types
// =============================================================================

export interface ColumnMapperProps {
  /** The app's logical column schemas (from manifest) */
  logicalColumns: AppColumnSchema[];
  /** The actual columns available in the selected table */
  actualColumns: AppColumnInfo[];
  /** Current mappings: logicalColumnName -> ColumnMapping */
  mappings: Record<string, ColumnMapping>;
  /** Called when a mapping changes */
  onMappingChange: (logicalName: string, mapping: ColumnMapping) => void;
  /** Title for the mapper section */
  title?: string;
  /** Additional class names */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ColumnMapper - Maps app's logical columns to actual table columns.
 *
 * For each logical column defined in the app manifest, shows a dropdown
 * to select which actual column in the table should be used.
 *
 * @example
 * ```tsx
 * <ColumnMapper
 *   logicalColumns={manifest.managedTables[0].columns}
 *   actualColumns={selectedTable.columns}
 *   mappings={columnMappings}
 *   onMappingChange={(name, mapping) => {
 *     setColumnMappings(prev => ({ ...prev, [name]: mapping }));
 *   }}
 *   title="Map columns for Deals"
 * />
 * ```
 */
export function ColumnMapper({
  logicalColumns,
  actualColumns,
  mappings,
  onMappingChange,
  title,
  className = '',
}: ColumnMapperProps) {
  const handleColumnSelect = (logicalName: string, actualColumnId: string) => {
    const actualColumn = actualColumns.find((col) => col.id === actualColumnId);
    if (actualColumn) {
      onMappingChange(logicalName, {
        columnId: actualColumn.id,
        columnName: actualColumn.name,
      });
    }
  };

  // Build options for each dropdown
  const actualColumnOptions = actualColumns.map((col) => ({
    value: col.id,
    label: col.name,
  }));

  return (
    <div className={className}>
      {title && <h3 className="text-body font-medium text-text mb-4">{title}</h3>}

      <div className="space-y-4">
        {logicalColumns.map((logicalCol) => {
          const currentMapping = mappings[logicalCol.name];
          const isRequired = logicalCol.required ?? false;

          return (
            <ColumnMappingRow
              key={logicalCol.name}
              logicalColumn={logicalCol}
              actualColumnOptions={actualColumnOptions}
              selectedColumnId={currentMapping?.columnId ?? null}
              onSelect={(columnId) => handleColumnSelect(logicalCol.name, columnId)}
              required={isRequired}
            />
          );
        })}
      </div>

      {/* Mapping summary */}
      <MappingSummary logicalColumns={logicalColumns} mappings={mappings} />
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface ColumnMappingRowProps {
  logicalColumn: AppColumnSchema;
  actualColumnOptions: Array<{ value: string; label: string }>;
  selectedColumnId: string | null;
  onSelect: (columnId: string) => void;
  required: boolean;
}

/**
 * ColumnMappingRow - Single row in the column mapper.
 */
function ColumnMappingRow({
  logicalColumn,
  actualColumnOptions,
  selectedColumnId,
  onSelect,
  required,
}: ColumnMappingRowProps) {
  const typeLabel = getTypeLabel(logicalColumn.type.kind);

  return (
    <div className="flex items-start gap-4">
      {/* Logical column info (left side) */}
      <div className="flex-1 min-w-0">
        <Label required={required}>{logicalColumn.name}</Label>
        <p className="text-caption text-ss-text-tertiary">Expected type: {typeLabel}</p>
      </div>

      {/* Arrow */}
      <div className="pt-2 text-ss-text-tertiary">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>

      {/* Actual column selector (right side) */}
      <div className="flex-1 min-w-0">
        <Select
          options={actualColumnOptions}
          value={selectedColumnId ?? ''}
          onChange={(value) => onSelect(value)}
          placeholder="Select column..."
        />
      </div>
    </div>
  );
}

interface MappingSummaryProps {
  logicalColumns: AppColumnSchema[];
  mappings: Record<string, ColumnMapping>;
}

/**
 * MappingSummary - Shows completion status of column mappings.
 */
function MappingSummary({ logicalColumns, mappings }: MappingSummaryProps) {
  const totalRequired = logicalColumns.filter((col) => col.required).length;
  const totalOptional = logicalColumns.length - totalRequired;
  const mappedRequired = logicalColumns.filter((col) => col.required && mappings[col.name]).length;
  const mappedOptional = logicalColumns.filter((col) => !col.required && mappings[col.name]).length;

  const allRequiredMapped = mappedRequired === totalRequired;

  return (
    <div className="mt-4 pt-4 border-t border-ss-border-light">
      <div className="flex items-center gap-4 text-caption">
        <span className={allRequiredMapped ? 'text-green-600' : 'text-ss-text-secondary'}>
          Required: {mappedRequired}/{totalRequired} mapped
        </span>
        {totalOptional > 0 && (
          <span className="text-ss-text-tertiary">
            Optional: {mappedOptional}/{totalOptional} mapped
          </span>
        )}
      </div>
      {!allRequiredMapped && (
        <p className="mt-1 text-caption text-amber-600">
          Please map all required columns to continue.
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get a human-readable label for a column type kind.
 */
function getTypeLabel(kind: string): string {
  const labels: Record<string, string> = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    checkbox: 'Checkbox',
    formula: 'Formula',
    select: 'Single select',
    multiselect: 'Multi-select',
    person: 'Person',
    file: 'File',
    url: 'URL',
    email: 'Email',
    phone: 'Phone',
    rating: 'Rating',
    progress: 'Progress',
    createdTime: 'Created time',
    modifiedTime: 'Modified time',
    createdBy: 'Created by',
    modifiedBy: 'Modified by',
    autoNumber: 'Auto number',
    relation: 'Relation',
    lookup: 'Lookup',
    rollup: 'Rollup',
  };

  return labels[kind] ?? kind;
}
