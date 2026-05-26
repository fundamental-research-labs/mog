/**
 * TestPanel Component
 *
 * Displays test assertions, results, and allows running tests.
 * Part of the Testing Foundation (
 *
 * Features:
 * - View all assertions
 * - Run all tests or specific suites
 * - View test results with pass/fail status
 * - Collapsible panel to save space
 *
 */

import { useCallback, useMemo, useState } from 'react';

import { ChevronDownSvg, CloseSvg, PlaySvg } from '@mog/icons';
import type { CellAssertion, TestResult } from '@mog/spreadsheet-testing';

import { useActiveSheetId } from '../../internal-api';
import { useTesting } from '../../hooks/settings/use-testing';
import { StatusBadge, type BadgeStatus } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

export interface TestPanelProps {
  /** Position of the panel */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Whether panel starts collapsed */
  defaultCollapsed?: boolean;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
  /** Called when panel is closed */
  onClose?: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Map test status to BadgeStatus for StatusBadge component */
const STATUS_TO_BADGE: Record<'pass' | 'fail' | 'pending', BadgeStatus> = {
  pass: 'success',
  fail: 'error',
  pending: 'idle',
};

/** Position classes for the panel */
const POSITION_CLASSES = {
  'top-right': 'top-2 right-2',
  'top-left': 'top-2 left-2',
  'bottom-right': 'bottom-12 right-2',
  'bottom-left': 'bottom-12 left-2',
} as const;

/** Assertion icon status classes */
const ASSERTION_ICON_CLASSES = {
  pass: 'bg-status-success text-ss-text-inverse',
  fail: 'bg-status-error text-ss-text-inverse',
  pending: 'bg-ss-text-disabled text-ss-text-inverse',
} as const;

// =============================================================================
// Helper Components
// =============================================================================

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <ChevronDownSvg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
  );
}

function CloseIcon() {
  return <CloseSvg style={{ width: 16, height: 16 }} />;
}

function PlayIcon() {
  return <PlaySvg style={{ width: 14, height: 14 }} />;
}

function formatCellAddress(assertion: CellAssertion): string {
  if (assertion.target.type === 'cell') {
    const col = String.fromCharCode(65 + assertion.target.col);
    return `${col}${assertion.target.row + 1}`;
  } else {
    const startCol = String.fromCharCode(65 + assertion.target.startCol);
    const endCol = String.fromCharCode(65 + assertion.target.endCol);
    return `${startCol}${assertion.target.startRow + 1}:${endCol}${assertion.target.endRow + 1}`;
  }
}

function getResultForAssertion(assertionId: string, results: TestResult[]): TestResult | undefined {
  return results.find((r) => r.assertionId === assertionId);
}

// =============================================================================
// Component
// =============================================================================

export function TestPanel({
  position = 'bottom-right',
  defaultCollapsed = false,
  className,
  style,
  onClose,
}: TestPanelProps) {
  const sheetId = useActiveSheetId();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const { assertions, suites, runAll, isRunning, lastResults, lastSummary } = useTesting({
    sheetId,
  });

  const handleToggle = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleRunAll = useCallback(async () => {
    await runAll();
  }, [runAll]);

  // Calculate status
  const statusInfo = useMemo(() => {
    if (!lastSummary) {
      return { type: 'pending' as const, text: 'Not run' };
    }
    if (lastSummary.failed === 0) {
      return { type: 'pass' as const, text: `${lastSummary.passed} passed` };
    }
    return { type: 'fail' as const, text: `${lastSummary.failed} failed` };
  }, [lastSummary]);

  return (
    <div
      className={`absolute z-ss-sticky flex flex-col font-ss-sans text-body select-none ${POSITION_CLASSES[position]} ${className ?? ''}`}
      style={style}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-ss-surface border border-ss-border cursor-pointer transition-shadow ${
          isCollapsed ? 'rounded-ss-lg' : 'rounded-t-lg border-b'
        }`}
        onClick={handleToggle}
      >
        <span className="flex-1 text-text-ss-primary font-semibold text-body-sm">Tests</span>
        <StatusBadge status={STATUS_TO_BADGE[statusInfo.type]} label={statusInfo.text} size="sm" />
        {onClose && (
          <button
            className="p-1 border-none bg-transparent cursor-pointer text-ss-text-secondary rounded hover:bg-ss-surface-hover flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <CloseIcon />
          </button>
        )}
        <ChevronIcon expanded={!isCollapsed} />
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="bg-ss-surface border border-ss-border border-t-0 rounded-b-lg shadow-ss-lg max-h-[400px] overflow-auto w-80">
          {/* Run Button */}
          <div className="px-4 py-3 border-b border-ss-border-light">
            <button
              className={`flex items-center justify-center gap-1.5 w-full py-2 px-4 bg-ss-primary text-ss-text-inverse border-none rounded-ss-md cursor-pointer text-body font-medium transition-colors ${
                isRunning ? 'bg-ss-primary/50 cursor-not-allowed' : 'hover:bg-ss-primary-hover'
              }`}
              onClick={handleRunAll}
              disabled={isRunning}
            >
              <PlayIcon />
              {isRunning ? 'Running...' : 'Run All Tests'}
            </button>
          </div>

          {/* Summary */}
          {lastSummary && (
            <div className="px-4 py-3 border-b border-ss-border-light">
              <div className="text-ribbon font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
                Summary
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-ss-text-secondary">Total</span>
                <span className="font-semibold text-text-ss-primary">{lastSummary.total}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-ss-text-secondary">Passed</span>
                <span className="font-semibold text-status-success">{lastSummary.passed}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-ss-text-secondary">Failed</span>
                <span
                  className={`font-semibold ${lastSummary.failed > 0 ? 'text-status-error' : 'text-text-ss-primary'}`}
                >
                  {lastSummary.failed}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-ss-text-secondary">Duration</span>
                <span className="font-semibold text-text-ss-primary">
                  {lastSummary.durationMs}ms
                </span>
              </div>
            </div>
          )}

          {/* Assertions List */}
          <div className="px-4 py-3 border-b border-ss-border-light">
            <div className="text-ribbon font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
              Assertions ({assertions.length})
            </div>

            {assertions.length === 0 ? (
              <div className="py-6 px-4 text-center text-ss-text-tertiary">
                No assertions defined.
                <br />
                Use =ASSERT() formulas to add tests.
              </div>
            ) : (
              assertions.map((assertion) => {
                const result = getResultForAssertion(assertion.id, lastResults);
                const status = result ? (result.passed ? 'pass' : 'fail') : 'pending';

                return (
                  <div key={assertion.id} className="flex items-center gap-2 py-1.5">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-ribbon-compact font-bold ${ASSERTION_ICON_CLASSES[status]}`}
                    >
                      {status === 'pass' ? '✓' : status === 'fail' ? '✗' : '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-body text-text-ss-primary font-medium truncate">
                        {assertion.name || `${assertion.type} assertion`}
                      </div>
                      <div className="text-ribbon text-ss-text-tertiary">
                        {formatCellAddress(assertion)}
                        {result && !result.passed && result.message && (
                          <span> - {result.message}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Suites */}
          {suites.length > 0 && (
            <div className="px-4 py-3 border-b border-ss-border-light">
              <div className="text-ribbon font-semibold text-ss-text-secondary uppercase tracking-wide mb-2">
                Test Suites ({suites.length})
              </div>
              {suites.map((suite) => (
                <div key={suite.id} className="flex items-center gap-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-body text-text-ss-primary font-medium truncate">
                      {suite.name}
                    </div>
                    <div className="text-ribbon text-ss-text-tertiary">
                      {suite.assertionIds.length} assertions
                      {suite.autoRun && ' • Auto-run enabled'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
