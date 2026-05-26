/**
 * Evaluate Formula Dialog
 *
 * A dialog that allows users to step through formula evaluation to understand
 * how Excel calculates the result. Users can see intermediate values and
 * step into/out of nested formulas.
 *
 * Excel Parity: Formulas > Formula Auditing > Evaluate Formula
 *
 * Features:
 * - Step-through formula evaluation
 * - Show intermediate values
 * - Step In/Step Out buttons for nested formulas
 * - Highlight current expression being evaluated
 */

import { useCallback, useMemo } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

export function EvaluateFormulaDialog() {
  // Get state from UIStore
  const isOpen = useUIStore((s) => s.evaluateFormulaDialog.isOpen);
  const cellRef = useUIStore((s) => s.evaluateFormulaDialog.cellRef);
  const originalFormula = useUIStore((s) => s.evaluateFormulaDialog.originalFormula);
  const currentFormula = useUIStore((s) => s.evaluateFormulaDialog.currentFormula);
  const steps = useUIStore((s) => s.evaluateFormulaDialog.steps);
  const currentStepIndex = useUIStore((s) => s.evaluateFormulaDialog.currentStepIndex);
  const currentDepth = useUIStore((s) => s.evaluateFormulaDialog.currentDepth);
  const isComplete = useUIStore((s) => s.evaluateFormulaDialog.isComplete);
  const finalResult = useUIStore((s) => s.evaluateFormulaDialog.finalResult);

  // Get actions from UIStore
  const closeEvaluateFormulaDialog = useUIStore((s) => s.closeEvaluateFormulaDialog);
  const evaluateNext = useUIStore((s) => s.evaluateNext);
  const stepInto = useUIStore((s) => s.stepInto);
  const stepOut = useUIStore((s) => s.stepOut);
  const restartEvaluation = useUIStore((s) => s.restartEvaluation);

  // Get current step
  const currentStep = useMemo(() => {
    if (currentStepIndex < 0 || currentStepIndex >= steps.length) {
      return null;
    }
    return steps[currentStepIndex];
  }, [steps, currentStepIndex]);

  // Check if we can step in/out
  const canStepIn = currentStep?.hasSubSteps ?? false;
  const canStepOut = currentDepth > 0;
  const hasSteps = steps.length > 0;

  // Format result value for display
  const formatValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return '#NUM!';
      if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
      return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '');
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return `"${value}"`;
    if (Array.isArray(value)) return `{Array: ${value.length} items}`;
    if (value instanceof Error) return value.message;
    return String(value);
  }, []);

  // Handle closing
  const handleClose = useCallback(() => {
    closeEvaluateFormulaDialog();
  }, [closeEvaluateFormulaDialog]);

  // Handle evaluate
  // Note: EVALUATE_NEXT_STEP action handles stepping through
  const handleEvaluate = useCallback(() => {
    // The evaluateNext UIStore action handles both starting and continuing
    evaluateNext();
  }, [evaluateNext]);

  // Handle step in
  const handleStepIn = useCallback(() => {
    stepInto();
  }, [stepInto]);

  // Handle step out
  const handleStepOut = useCallback(() => {
    stepOut();
  }, [stepOut]);

  // Handle restart
  const handleRestart = useCallback(() => {
    restartEvaluation();
  }, [restartEvaluation]);

  // Enter-to-evaluate (when not complete) is handled by Dialog's onEnterKeyDown prop.
  // Escape-to-close is handled natively by the Dialog primitive.

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      dialogId="evaluate-formula-dialog"
      width="lg"
      onEnterKeyDown={() => {
        if (!isComplete) handleEvaluate();
      }}
    >
      <DialogHeader onClose={handleClose}>Evaluate Formula</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4" tabIndex={0}>
          {/* Reference info */}
          <div className="text-body-sm text-ss-text-secondary">
            Reference: <span className="font-ss-mono text-text">{cellRef}</span>
          </div>

          {/* Evaluation section */}
          <div className="border border-ss-border rounded p-4">
            <div className="text-body-sm text-ss-text-secondary mb-2">Evaluation:</div>

            {/* Formula display - shows underlined portion being evaluated */}
            <div className="bg-ss-surface-secondary rounded p-3 font-ss-mono text-body-sm mb-3 overflow-x-auto">
              {isComplete ? (
                <span className="text-text">{currentFormula}</span>
              ) : currentStep ? (
                <FormulaWithHighlight formula={currentFormula} highlight={currentStep.expression} />
              ) : (
                <span className="text-text">{originalFormula}</span>
              )}
            </div>

            {/* Current step result */}
            {currentStep && !isComplete && (
              <div className="bg-ss-primary-lighter rounded p-3 mb-3">
                <div className="text-body-sm text-ss-text-secondary mb-1">
                  {currentStep.description || 'Evaluating expression:'}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-ss-mono text-body-sm text-ss-text-secondary">
                    {currentStep.expression}
                  </span>
                  <span className="text-ss-text-secondary">=</span>
                  <span className="font-ss-mono text-body font-medium text-ss-primary">
                    {formatValue(currentStep.result)}
                  </span>
                </div>
              </div>
            )}

            {/* Final result */}
            {isComplete && (
              <div className="bg-ss-success/10 rounded p-3">
                <div className="text-body-sm text-ss-text-secondary mb-1">Result:</div>
                <div className="font-ss-mono text-body font-medium text-ss-success">
                  {formatValue(finalResult)}
                </div>
              </div>
            )}

            {/* Step depth indicator */}
            {currentDepth > 0 && (
              <div className="text-caption text-ss-text-tertiary mt-2">
                Evaluation depth: {currentDepth}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="text-body-sm text-ss-text-secondary">
            {isComplete ? (
              'Evaluation complete. Click "Restart" to evaluate again.'
            ) : !hasSteps ? (
              'Click "Evaluate" to start stepping through the formula calculation.'
            ) : (
              <>
                The <span className="underline">underlined</span> expression will be evaluated.
                Click "Evaluate" to see the result.
              </>
            )}
          </div>

          {/* Step history (optional, shows last few steps) */}
          {steps.length > 0 && currentStepIndex > 0 && (
            <div className="border-t border-ss-border pt-3">
              <div className="text-caption text-ss-text-secondary mb-2">Previous steps:</div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {steps
                  .slice(Math.max(0, currentStepIndex - 3), currentStepIndex)
                  .map((step: { expression: string; result: unknown }, i: number) => (
                    <div key={i} className="text-caption text-ss-text-tertiary font-ss-mono">
                      {step.expression} = {formatValue(step.result)}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleStepIn}
            disabled={!canStepIn || isComplete}
            title="Step into nested function"
          >
            Step In
          </Button>
          <Button
            variant="secondary"
            onClick={handleStepOut}
            disabled={!canStepOut || isComplete}
            title="Step out of current function"
          >
            Step Out
          </Button>
        </div>
        <div className="flex gap-2">
          {isComplete ? (
            <Button variant="secondary" onClick={handleRestart}>
              Restart
            </Button>
          ) : (
            <Button variant="primary" onClick={handleEvaluate}>
              Evaluate
            </Button>
          )}
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface FormulaWithHighlightProps {
  formula: string;
  highlight: string;
}

/**
 * Displays a formula with a portion underlined to show what's being evaluated
 */
function FormulaWithHighlight({ formula, highlight }: FormulaWithHighlightProps) {
  // Find the position of the highlight in the formula
  const highlightIndex = formula.indexOf(highlight);

  if (highlightIndex === -1) {
    // Highlight not found, just show the formula
    return <span className="text-text">{formula}</span>;
  }

  const before = formula.slice(0, highlightIndex);
  const after = formula.slice(highlightIndex + highlight.length);

  return (
    <span className="text-text">
      {before}
      <span className="underline decoration-primary decoration-2 text-ss-primary font-medium">
        {highlight}
      </span>
      {after}
    </span>
  );
}
