/**
 * Circular Reference Dialog
 *
 * G.3: Shown when a formula creates a circular reference.
 * Offers options to:
 * - Enable iterative calculation (allow the circular reference to iterate)
 * - Dismiss the warning
 *
 * This follows Excel's behavior where circular references show a dialog
 * allowing the user to enable iterative calculation.
 *
 */

import { useCallback, useState } from 'react';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Switch } from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

export interface CircularReferenceState {
  open: boolean;
  /** Cell address that creates the circular reference (e.g., "A1") */
  cellAddress: string;
  /** Formula that creates the circular reference */
  formula: string;
}

export interface CircularReferenceCallbacks {
  /** Enable iterative calculation and proceed with the formula */
  onEnableIterative: () => void;
  /** Dismiss the warning */
  onCancel: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to manage circular reference dialog state.
 *
 * @example
 * ```tsx
 * const { state, showDialog, handleEnableIterative, handleCancel } = useCircularReferenceDialog();
 *
 * // When circular reference is detected
 * showDialog('A1', '=B1+A1', handleEnableIterative, handleCancel);
 *
 * // Render dialog
 * <CircularReferenceDialog
 * state={state}
 * onEnableIterative={handleEnableIterative}
 * onCancel={handleCancel}
 * />
 * ```
 */
export function useCircularReferenceDialog() {
  const [state, setState] = useState<CircularReferenceState>({
    open: false,
    cellAddress: '',
    formula: '',
  });

  const [callbacks, setCallbacks] = useState<Partial<CircularReferenceCallbacks>>({});

  const showDialog = useCallback(
    (cellAddress: string, formula: string, onEnableIterative: () => void, onCancel: () => void) => {
      setCallbacks({ onEnableIterative, onCancel });
      setState({
        open: true,
        cellAddress,
        formula,
      });
    },
    [],
  );

  const handleEnableIterative = useCallback(() => {
    callbacks.onEnableIterative?.();
    setState((s) => ({ ...s, open: false }));
  }, [callbacks]);

  const handleCancel = useCallback(() => {
    callbacks.onCancel?.();
    setState((s) => ({ ...s, open: false }));
  }, [callbacks]);

  return {
    state,
    showDialog,
    handleEnableIterative,
    handleCancel,
  };
}

// =============================================================================
// Component
// =============================================================================

interface CircularReferenceDialogProps {
  state: CircularReferenceState;
  onEnableIterative: () => void;
  onCancel: () => void;
  /** Current iterative calculation settings (for display) */
  iterativeSettings?: {
    maxIterations: number;
    maxChange: number;
  };
}

/**
 * CircularReferenceDialog - Modal dialog for circular reference errors.
 *
 * G.3: Shows when a formula creates a circular reference.
 * User can choose to:
 * - Enable iterative calculation (formula will iterate until convergence)
 * - Dismiss the warning
 *
 * Excel-like behavior:
 * - Shows the cell address and formula causing the circular reference
 * - Explains what iterative calculation does
 * - Default action is to keep iterative calculation disabled
 */
export function CircularReferenceDialog({
  state,
  onEnableIterative,
  onCancel,
  iterativeSettings,
}: CircularReferenceDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false);

  const handleEnableIterative = useCallback(() => {
    onEnableIterative();
  }, [onEnableIterative]);

  return (
    <Dialog open={state.open} onClose={onCancel} dialogId="circular-reference-dialog" width="md">
      <DialogHeader onClose={onCancel}>Circular Reference Warning</DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            {/* Warning icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ss-warning-100 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-ss-warning-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <p className="text-body font-medium text-text-ss-primary m-0">
                Circular reference detected in cell {state.cellAddress}
              </p>
              <p className="text-body text-ss-text-secondary mt-1 mb-0">
                The formula references its own cell, creating a circular dependency.
              </p>
            </div>
          </div>

          {/* Display the problematic formula */}
          <div className="bg-ss-surface-secondary rounded-ss-md p-3 font-ss-mono text-body-sm overflow-x-auto">
            <code className="text-text-ss-primary">{state.formula}</code>
          </div>

          <div className="bg-ss-info-50 border border-info-200 rounded-ss-md p-3">
            <p className="text-body-sm text-info-800 m-0">
              <strong>What is iterative calculation?</strong>
            </p>
            <p className="text-body-sm text-info-700 mt-1 mb-0">
              Iterative calculation allows formulas with circular references to calculate repeatedly
              until the results converge (stop changing) or reach the maximum number of iterations.
            </p>
            {iterativeSettings && (
              <p className="text-body-sm text-info-600 mt-2 mb-0">
                Current settings: Maximum {iterativeSettings.maxIterations} iterations, maximum
                change of {iterativeSettings.maxChange}
              </p>
            )}
          </div>

          <Switch
            checked={rememberChoice}
            onChange={(checked) => setRememberChoice(checked)}
            label="Enable iterative calculation for this workbook"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          OK
        </Button>
        <Button variant="primary" onClick={handleEnableIterative}>
          Enable Iterative Calculation
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
