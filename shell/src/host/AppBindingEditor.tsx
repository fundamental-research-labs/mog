/**
 * AppBindingEditor - Multi-step wizard for binding app tables to existing data
 *
 * Combines TablePicker and ColumnMapper into a step-by-step flow:
 * 1. For each managed table in the manifest, show TablePicker
 * 2. After table selection, show ColumnMapper
 * 3. On finish, return all bindings
 *
 */

import type {
  AppManifest,
  AppTableInfo,
  AppTableSchema,
  ColumnMapping,
  TableBinding,
} from '@mog-sdk/contracts/apps';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../components/ui/radix/Dialog';
import { ColumnMapper } from './ColumnMapper';
import { TablePicker } from './TablePicker';

// =============================================================================
// Types
// =============================================================================

export interface AppBindingEditorProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** The app manifest with managed tables info */
  manifest: AppManifest;
  /** All tables available in the workbook */
  tables: AppTableInfo[];
  /** Called when binding is complete with all table bindings */
  onComplete: (bindings: Record<string, TableBinding>) => void;
}

type WizardStep =
  | { type: 'table-selection'; tableIndex: number }
  | { type: 'column-mapping'; tableIndex: number };

interface TableBindingState {
  tableId: string | null;
  columnMappings: Record<string, ColumnMapping>;
}

// =============================================================================
// Component
// =============================================================================

/**
 * AppBindingEditor - Wizard for binding app tables to existing data.
 *
 * Walks the user through:
 * 1. Selecting an existing table for each managed table
 * 2. Mapping columns from the app's schema to actual columns
 *
 * @example
 * ```tsx
 * <AppBindingEditor
 *   open={showBindingEditor}
 *   onClose={() => setShowBindingEditor(false)}
 *   manifest={crmManifest}
 *   tables={workbookTables}
 *   onComplete={(bindings) => {
 *     saveBindings(bindings);
 *     setShowBindingEditor(false);
 *   }}
 * />
 * ```
 */
export function AppBindingEditor({
  open,
  onClose,
  manifest,
  tables,
  onComplete,
}: AppBindingEditorProps) {
  const managedTables = manifest.managedTables ?? [];

  // State for each table's bindings
  const [bindingStates, setBindingStates] = useState<Record<string, TableBindingState>>(() => {
    const initial: Record<string, TableBindingState> = {};
    for (const table of managedTables) {
      initial[table.name] = {
        tableId: null,
        columnMappings: {},
      };
    }
    return initial;
  });

  // Current wizard step
  const [currentStep, setCurrentStep] = useState<WizardStep>({
    type: 'table-selection',
    tableIndex: 0,
  });

  // Get current managed table
  const currentManagedTable = managedTables[currentStep.tableIndex];

  // Get current binding state
  const currentBindingState = currentManagedTable ? bindingStates[currentManagedTable.name] : null;

  // Get the selected actual table
  const selectedActualTable = useMemo(() => {
    if (!currentBindingState?.tableId) return null;
    return tables.find((t) => t.id === currentBindingState.tableId) ?? null;
  }, [tables, currentBindingState?.tableId]);

  // Calculate progress
  const totalSteps = managedTables.length * 2; // table + columns for each
  const currentStepNumber =
    currentStep.tableIndex * 2 + (currentStep.type === 'column-mapping' ? 2 : 1);

  // Check if current step is valid to proceed
  const canProceed = useMemo(() => {
    if (!currentManagedTable || !currentBindingState) return false;

    if (currentStep.type === 'table-selection') {
      return currentBindingState.tableId !== null;
    }

    // For column mapping, check that all required columns are mapped
    const requiredColumns = currentManagedTable.columns.filter((col) => col.required);
    return requiredColumns.every((col) => currentBindingState.columnMappings[col.name]);
  }, [currentStep, currentManagedTable, currentBindingState]);

  // Handle table selection
  const handleTableSelect = useCallback(
    (tableId: string) => {
      if (!currentManagedTable) return;

      setBindingStates((prev) => ({
        ...prev,
        [currentManagedTable.name]: {
          ...prev[currentManagedTable.name],
          tableId,
          // Reset column mappings when table changes
          columnMappings: {},
        },
      }));
    },
    [currentManagedTable],
  );

  // Handle column mapping change
  const handleColumnMappingChange = useCallback(
    (logicalName: string, mapping: ColumnMapping) => {
      if (!currentManagedTable) return;

      setBindingStates((prev) => ({
        ...prev,
        [currentManagedTable.name]: {
          ...prev[currentManagedTable.name],
          columnMappings: {
            ...prev[currentManagedTable.name].columnMappings,
            [logicalName]: mapping,
          },
        },
      }));
    },
    [currentManagedTable],
  );

  // Navigation handlers
  const handleBack = useCallback(() => {
    if (currentStep.type === 'column-mapping') {
      setCurrentStep({ type: 'table-selection', tableIndex: currentStep.tableIndex });
    } else if (currentStep.tableIndex > 0) {
      setCurrentStep({ type: 'column-mapping', tableIndex: currentStep.tableIndex - 1 });
    }
  }, [currentStep]);

  const handleNext = useCallback(() => {
    if (currentStep.type === 'table-selection') {
      setCurrentStep({ type: 'column-mapping', tableIndex: currentStep.tableIndex });
    } else if (currentStep.tableIndex < managedTables.length - 1) {
      setCurrentStep({ type: 'table-selection', tableIndex: currentStep.tableIndex + 1 });
    } else {
      // All done - build final bindings and call onComplete
      const finalBindings: Record<string, TableBinding> = {};
      for (const [tableName, state] of Object.entries(bindingStates)) {
        finalBindings[tableName] = {
          tableId: state.tableId as AppTableInfo['id'],
          columnMappings: state.columnMappings,
          isManaged: false, // Using existing tables, not managed
        };
      }
      onComplete(finalBindings);
    }
  }, [currentStep, managedTables.length, bindingStates, onComplete]);

  // Determine button labels
  const isFirstStep = currentStep.type === 'table-selection' && currentStep.tableIndex === 0;
  const isLastStep =
    currentStep.type === 'column-mapping' && currentStep.tableIndex === managedTables.length - 1;

  if (managedTables.length === 0) {
    return (
      <Dialog open={open} onClose={onClose} width="md">
        <DialogHeader onClose={onClose}>Bind Data for {manifest.name}</DialogHeader>
        <DialogBody>
          <div className="text-center py-8">
            <p className="text-body text-ss-text-secondary">
              This app does not define any managed tables.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} width="lg">
      <DialogHeader onClose={onClose}>Bind Data for {manifest.name}</DialogHeader>

      <DialogBody>
        {/* Progress indicator */}
        <WizardProgress
          currentStep={currentStepNumber}
          totalSteps={totalSteps}
          managedTables={managedTables}
          currentTableIndex={currentStep.tableIndex}
          currentStepType={currentStep.type}
        />

        <div className="mt-6">
          {currentStep.type === 'table-selection' && currentManagedTable && (
            <div>
              <h3 className="text-body font-medium text-text mb-4">
                Select a table for: {currentManagedTable.name}
              </h3>
              <TablePicker
                label={`${currentManagedTable.name} table`}
                tables={tables}
                selectedTableId={currentBindingState?.tableId ?? null}
                onSelect={handleTableSelect}
                required
                description={`This table needs ${currentManagedTable.columns.length} columns`}
              />
            </div>
          )}

          {currentStep.type === 'column-mapping' && currentManagedTable && selectedActualTable && (
            <ColumnMapper
              title={`Map columns: ${currentManagedTable.name} -> ${selectedActualTable.name}`}
              logicalColumns={currentManagedTable.columns}
              actualColumns={selectedActualTable.columns}
              mappings={currentBindingState?.columnMappings ?? {}}
              onMappingChange={handleColumnMappingChange}
            />
          )}
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <div className="flex gap-3">
          {!isFirstStep && (
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={handleNext} disabled={!canProceed}>
            {isLastStep ? 'Finish' : 'Continue'}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
  managedTables: AppTableSchema[];
  currentTableIndex: number;
  currentStepType: WizardStep['type'];
}

/**
 * WizardProgress - Shows progress through the binding wizard.
 */
function WizardProgress({
  currentStep,
  totalSteps,
  managedTables,
  currentTableIndex,
  currentStepType,
}: WizardProgressProps) {
  const progressPercentage = (currentStep / totalSteps) * 100;

  return (
    <div>
      {/* Progress bar */}
      <div className="h-1.5 bg-ss-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-ss-primary transition-all duration-300"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Step indicators */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {managedTables.map((table, index) => {
          const isActive = index === currentTableIndex;
          const isComplete = index < currentTableIndex;
          const stepText =
            isActive && currentStepType === 'column-mapping'
              ? 'Mapping columns'
              : isActive
                ? 'Selecting table'
                : isComplete
                  ? 'Done'
                  : 'Pending';

          return (
            <div
              key={table.name}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full text-caption
                ${isActive ? 'bg-ss-primary-light text-ss-primary' : ''}
                ${isComplete ? 'bg-green-100 text-green-700' : ''}
                ${!isActive && !isComplete ? 'bg-ss-surface-secondary text-ss-text-tertiary' : ''}
              `}
            >
              <span className="font-medium">{table.name}</span>
              <span className="text-inherit opacity-75">({stepText})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
