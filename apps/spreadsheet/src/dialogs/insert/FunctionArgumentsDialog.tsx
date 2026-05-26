/**
 * Function Arguments Dialog
 *
 * A dialog that allows users to edit arguments for a function at the current cursor position.
 * This is context-aware - it detects which function the cursor is inside and shows argument fields.
 *
 * Uses dispatch() for all interactions (CLOSE_FUNCTION_ARGUMENTS_DIALOG).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CollapsibleRangeInput,
  dispatch,
  useActionDependencies,
  useActiveSheetId,
  useEditorState,
  useWorkbook,
} from '../../internal-api';

import { globalRegistry } from '@mog/spreadsheet-utils/function-registry';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';
import { analyzeFormulaContext } from '../../domain/editor/formula-context';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';

// =============================================================================
// Types
// =============================================================================

interface FunctionMetadata {
  name: string;
  category: string;
  description: string;
  args: Array<{
    name: string;
    description: string;
    optional?: boolean;
    /** Whether this argument accepts a range reference */
    isRange?: boolean;
  }>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Detect if a function argument accepts a range reference based on name patterns.
 * Common patterns: range, array, values, ref, data, lookup, table, etc.
 */
function isRangeArgument(name?: string, type?: string): boolean {
  if (!name) return false;

  const lowerName = name.toLowerCase();

  // Check type metadata if available
  if (type === 'range' || type === 'reference' || type === 'array') {
    return true;
  }

  // Common patterns in Excel function argument names
  const rangePatterns = [
    'range',
    'array',
    'values',
    'ref',
    'reference',
    'data',
    'lookup',
    'table',
    'cells',
    'area',
    'criteria_range',
    'sum_range',
    'average_range',
    'count_range',
    'database',
    'vector',
    'source',
  ];

  return rangePatterns.some((pattern) => lowerName.includes(pattern) || lowerName === pattern);
}

// =============================================================================
// Component
// =============================================================================

interface FunctionArgumentsDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Function to insert/update the formula when user clicks OK */
  onInsert: (formula: string) => void;
}

export function FunctionArgumentsDialog({ open, onInsert }: FunctionArgumentsDialogProps) {
  const deps = useActionDependencies();
  const { isEditing, value, cursorPosition } = useEditorState();
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // State for argument values
  const [argValues, setArgValues] = useState<string[]>([]);

  // Analyze formula context to get current function
  const formulaContext = useMemo(() => {
    if (!isEditing || !value.startsWith('=')) {
      return null;
    }
    return analyzeFormulaContext(value, cursorPosition);
  }, [isEditing, value, cursorPosition]);

  const currentFunction = formulaContext?.currentFunction || null;

  // Get function metadata
  const functionMetadata = useMemo((): FunctionMetadata | null => {
    if (!currentFunction) return null;

    const meta = globalRegistry.getMetadata(currentFunction);
    if (!meta) return null;

    // Convert metadata to our format
    const args: FunctionMetadata['args'] = [];

    // If the function has argument metadata, use it
    if (meta.arguments && Array.isArray(meta.arguments)) {
      for (const arg of meta.arguments) {
        // Detect if argument is a range type based on name patterns or type metadata
        const isRange = isRangeArgument(arg.name, arg.type);
        args.push({
          name: arg.name || 'value',
          description: arg.description || '',
          optional: arg.optional || false,
          isRange,
        });
      }
    } else {
      // Fallback: create generic arguments based on minArgs/maxArgs
      const minArgs = meta.minArgs ?? 0;
      const maxArgs = meta.maxArgs ?? minArgs;
      const argCount = Math.min(maxArgs, 10); // Cap at 10 for UI

      for (let i = 0; i < argCount; i++) {
        args.push({
          name: `arg${i + 1}`,
          description: '',
          optional: i >= minArgs,
        });
      }
    }

    return {
      name: meta.name,
      category: meta.category,
      description: meta.description,
      args,
    };
  }, [currentFunction]);

  // Build the current formula string for preview
  const currentFormula = useMemo(() => {
    if (!functionMetadata) return '';
    const argsStr = argValues.filter((v) => v.trim()).join(', ');
    return `=${functionMetadata.name}(${argsStr})`;
  }, [functionMetadata, argValues]);

  // Compute result preview (Real-time result preview)
  const resultPreview = useMemo(() => {
    // Don't evaluate if no formula, context, or arguments
    if (!currentFormula || currentFormula === '=' || !wb || !activeSheetId) {
      return { value: null, error: null };
    }

    // Don't evaluate if all arguments are empty
    const hasArgs = argValues.some((v) => v.trim());
    if (!hasArgs) {
      return { value: null, error: null };
    }

    // TODO: Wire to ComputeBridge.evaluateFormula() to enable live preview
    return { value: null, error: null };
  }, [currentFormula, wb, activeSheetId, argValues]);

  // Initialize argument values when dialog opens
  useEffect(() => {
    if (!open || !functionMetadata) {
      setArgValues([]);
      return;
    }

    // Initialize with empty strings for each argument
    const initialValues = functionMetadata.args.map(() => '');
    setArgValues(initialValues);
  }, [open, functionMetadata]);

  // Handle closing
  const handleClose = useCallback(() => {
    dispatch('CLOSE_FUNCTION_ARGUMENTS_DIALOG', deps);
    setArgValues([]);
  }, [deps]);

  // Handle OK - construct formula and insert
  const handleOK = useCallback(() => {
    if (!functionMetadata) return;

    // Build formula with current argument values
    const funcName = functionMetadata.name;
    const argsStr = argValues.filter((v) => v.trim()).join(', ');
    const formula = `=${funcName}(${argsStr})`;

    // Insert formula
    onInsert(formula);

    // Close dialog
    dispatch('CLOSE_FUNCTION_ARGUMENTS_DIALOG', deps);
    setArgValues([]);
  }, [deps, functionMetadata, argValues, onInsert]);

  // Handle argument change
  const handleArgChange = useCallback((index: number, value: string) => {
    setArgValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const guardedEnter = useRangeSelectionEnterGuard(handleOK);

  if (!open || !functionMetadata) return null;

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={true}
      onClose={handleClose}
      dialogId="function-arguments-dialog"
      width={600}
    >
      <DialogHeader onClose={handleClose}>Function Arguments</DialogHeader>

      <DialogBody className="!p-0 flex flex-col overflow-hidden max-h-[60vh]">
        {/* Function info */}
        <div className="p-4 border-b border-ss-border">
          <div className="text-body font-semibold text-ss-primary mb-1">
            {functionMetadata.name}
          </div>
          <div className="text-body-sm text-ss-text-secondary">{functionMetadata.description}</div>
        </div>

        {/* Argument fields */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {functionMetadata.args.map((arg, index) => (
            <div key={index}>
              <label className="block text-body-sm font-medium text-text mb-1">
                {arg.name}
                {arg.optional && <span className="text-ss-text-secondary ml-1">(optional)</span>}
              </label>
              {arg.isRange ? (
                <CollapsibleRangeInput
                  value={argValues[index] || ''}
                  onChange={(value) => handleArgChange(index, value)}
                  dialogId="function-arguments-dialog"
                  inputId={`arg-${index}`}
                  placeholder={arg.description || `Enter ${arg.name}`}
                  label={arg.name}
                />
              ) : (
                <Input
                  type="text"
                  value={argValues[index] || ''}
                  onChange={(e) => handleArgChange(index, e.target.value)}
                  placeholder={arg.description || `Enter ${arg.name}`}
                  autoFocus={index === 0}
                />
              )}
              {arg.description && (
                <div className="text-caption text-ss-text-secondary mt-1">{arg.description}</div>
              )}
            </div>
          ))}
        </div>

        {/* Result Preview (Real-time result preview) */}
        {(resultPreview.value !== null || resultPreview.error !== null) && (
          <div className="p-4 bg-ss-surface-secondary border-t border-ss-border">
            <div className="flex items-center gap-2">
              <span className="text-body-sm text-ss-text-secondary">Formula result =</span>
              {resultPreview.error ? (
                <span className="text-body font-ss-mono text-ss-error">{resultPreview.error}</span>
              ) : (
                <span className="text-body font-ss-mono text-text font-medium">
                  {resultPreview.value}
                </span>
              )}
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOK}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
