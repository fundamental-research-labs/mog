/**
 * useTesting Hook
 *
 * Manages the spreadsheet testing framework with Yjs collaboration support.
 * Enables "unit tests for spreadsheets" - users can define assertions on cells,
 * run test suites, and catch errors before they reach stakeholders.
 *
 * State architecture:
 * - Yjs: Assertions and test suites (persistent, collaborative)
 * - Local state: Test results, running status (ephemeral)
 *
 * Cell values are read from ViewportBuffer (sync) via createCellValueProvider().
 * The ICellValueProvider interface from @mog/spreadsheet-testing expects sync access,
 * so ViewportBuffer is the correct data source for viewport-visible cells.
 *
 * @module hooks/use-testing
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssertionFailedEvent, TestsCompletedEvent } from '@mog-sdk/contracts/testing';
import {
  createTestingFramework,
  type CellAssertion,
  type ICellValueProvider,
  type TestResult,
  type TestRunSummary,
  type TestSuite,
} from '@mog/spreadsheet-testing';

import type { SheetId } from '@mog-sdk/contracts/core';

import type { Worksheet } from '@mog-sdk/contracts/api';
import { useActiveSheetId, useEventBus, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseTestingOptions {
  /** Current sheet ID */
  sheetId: SheetId;

  /** Auto-run tests after recalculation */
  autoRunOnRecalc?: boolean;
}

export interface UseTestingReturn {
  // ===========================================================================
  // Assertions
  // ===========================================================================

  /** All assertions for the current document */
  assertions: CellAssertion[];

  /** Add a new assertion */
  addAssertion: (assertion: Omit<CellAssertion, 'id'>) => CellAssertion;

  /** Update an existing assertion */
  updateAssertion: (id: string, updates: Partial<CellAssertion>) => void;

  /** Remove an assertion */
  removeAssertion: (id: string) => void;

  /** Get assertions for a specific cell */
  getAssertionsForCell: (row: number, col: number) => CellAssertion[];

  // ===========================================================================
  // Test Suites
  // ===========================================================================

  /** All test suites */
  suites: TestSuite[];

  /** Create a new test suite */
  createSuite: (name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>) => TestSuite;

  /** Update a suite */
  updateSuite: (id: string, updates: Partial<TestSuite>) => void;

  /** Delete a suite */
  deleteSuite: (id: string) => void;

  /** Add assertions to a suite */
  addAssertionsToSuite: (suiteId: string, assertionIds: string[]) => void;

  /** Remove assertions from a suite */
  removeAssertionsFromSuite: (suiteId: string, assertionIds: string[]) => void;

  // ===========================================================================
  // Test Execution
  // ===========================================================================

  /** Run all enabled assertions */
  runAll: () => Promise<TestResult[]>;

  /** Run a specific suite */
  runSuite: (suiteId: string) => Promise<TestResult[]>;

  /** Run assertions for a specific cell */
  runCell: (row: number, col: number) => Promise<TestResult[]>;

  /** Whether tests are currently running */
  isRunning: boolean;

  /** Last test run results */
  lastResults: TestResult[];

  /** Last test run summary */
  lastSummary: TestRunSummary | null;

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /** Toggle auto-run mode */
  setAutoRun: (enabled: boolean) => void;

  /** Whether auto-run is enabled */
  isAutoRunEnabled: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a cell value provider that reads from the Worksheet viewport
 */
function createCellValueProvider(ws: Worksheet, _sheetId: SheetId): ICellValueProvider {
  // TODO: Cells.getDisplayValue is now async but ICellValueProvider expects sync.
  // Use viewport for sync access or make ICellValueProvider async.
  return {
    getCellValue(_sId: string, row: number, col: number): unknown {
      // Use viewport for sync access (viewport cells only)
      const vpCell = ws.viewport.getCellData(row, col);
      if (vpCell?.value != null) {
        return vpCell.value;
      }
      return '';
    },
    getRangeValues(
      _sId: string,
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number,
    ): unknown[][] {
      const result: unknown[][] = [];
      for (let row = startRow; row <= endRow; row++) {
        const rowValues: unknown[] = [];
        for (let col = startCol; col <= endCol; col++) {
          // Use viewport for sync access (viewport cells only)
          const vpCell = ws.viewport.getCellData(row, col);
          rowValues.push(vpCell?.value ?? '');
        }
        result.push(rowValues);
      }
      return result;
    },
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing the spreadsheet testing framework
 */
export function useTesting({
  sheetId,
  autoRunOnRecalc = false,
}: UseTestingOptions): UseTestingReturn {
  const wb = useWorkbook();
  const eventBus = useEventBus();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // Create testing framework instance (memoized)
  const framework = useMemo(() => {
    const valueProvider = createCellValueProvider(ws, sheetId);
    return createTestingFramework({
      valueProvider,
      // Integrate with event bus for emitting test events
      eventEmitter: {
        emit: (event: TestsCompletedEvent | AssertionFailedEvent) => {
          // Emit to the spreadsheet event bus for cross-component communication
          // Note: We use a custom event type since testing events aren't in the base SpreadsheetEvent union
          // @ts-expect-error - TestingEvents are extension events
          eventBus.emit(event);
        },
      },
    });
  }, [ws, sheetId, eventBus]);

  // Local state
  const [assertions, setAssertions] = useState<CellAssertion[]>(() => framework.getAllAssertions());
  const [suites, setSuites] = useState<TestSuite[]>(() => framework.listSuites());
  const [isRunning, setIsRunning] = useState(false);
  const [lastResults, setLastResults] = useState<TestResult[]>([]);
  const [lastSummary, setLastSummary] = useState<TestRunSummary | null>(null);
  const [isAutoRunEnabled, setIsAutoRunEnabled] = useState(() => framework.isAutoRunEnabled());

  // Ref to track if component is mounted
  const isMountedRef = useRef(true);

  // Subscribe to assertion changes
  useEffect(() => {
    const unsubscribe = framework.onAssertionsChanged(() => {
      if (isMountedRef.current) {
        setAssertions(framework.getAllAssertions());
      }
    });
    return () => unsubscribe();
  }, [framework]);

  // Subscribe to suite changes
  useEffect(() => {
    const unsubscribe = framework.onSuitesChanged(() => {
      if (isMountedRef.current) {
        setSuites(framework.listSuites());
      }
    });
    return () => unsubscribe();
  }, [framework]);

  // Subscribe to test completion events
  useEffect(() => {
    const unsubscribe = framework.onTestsCompleted((results, summary) => {
      if (isMountedRef.current) {
        setLastResults(results);
        setLastSummary(summary);
        setIsRunning(false);
      }
    });
    return () => unsubscribe();
  }, [framework]);

  // Auto-run tests after recalculation (if enabled)
  useEffect(() => {
    if (!autoRunOnRecalc && !isAutoRunEnabled) return;

    const unsubscribe = eventBus.on('recalc:completed', async () => {
      if (isMountedRef.current) {
        await framework.runAutoRunSuites();
      }
    });

    return () => unsubscribe();
  }, [framework, autoRunOnRecalc, isAutoRunEnabled, eventBus]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      framework.clearHandlers();
    };
  }, [framework]);

  // ===========================================================================
  // Assertion Methods
  // ===========================================================================

  const addAssertion = useCallback(
    (assertion: Omit<CellAssertion, 'id'>): CellAssertion => {
      return framework.addAssertion(assertion);
    },
    [framework],
  );

  const updateAssertion = useCallback(
    (id: string, updates: Partial<CellAssertion>): void => {
      framework.updateAssertion(id, updates);
    },
    [framework],
  );

  const removeAssertion = useCallback(
    (id: string): void => {
      framework.removeAssertion(id);
    },
    [framework],
  );

  const getAssertionsForCell = useCallback(
    (row: number, col: number): CellAssertion[] => {
      return framework.getAssertionsForCell(sheetId, row, col);
    },
    [framework, sheetId],
  );

  // ===========================================================================
  // Suite Methods
  // ===========================================================================

  const createSuite = useCallback(
    (name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>): TestSuite => {
      return framework.createSuite(name, options);
    },
    [framework],
  );

  const updateSuite = useCallback(
    (id: string, updates: Partial<TestSuite>): void => {
      framework.updateSuite(id, updates);
    },
    [framework],
  );

  const deleteSuite = useCallback(
    (id: string): void => {
      framework.deleteSuite(id);
    },
    [framework],
  );

  const addAssertionsToSuite = useCallback(
    (suiteId: string, assertionIds: string[]): void => {
      framework.addAssertionsToSuite(suiteId, assertionIds);
    },
    [framework],
  );

  const removeAssertionsFromSuite = useCallback(
    (suiteId: string, assertionIds: string[]): void => {
      framework.removeAssertionsFromSuite(suiteId, assertionIds);
    },
    [framework],
  );

  // ===========================================================================
  // Test Execution Methods
  // ===========================================================================

  const runAll = useCallback(async (): Promise<TestResult[]> => {
    setIsRunning(true);
    try {
      const results = await framework.runAll();
      return results;
    } finally {
      if (isMountedRef.current) {
        setIsRunning(false);
      }
    }
  }, [framework]);

  const runSuite = useCallback(
    async (suiteId: string): Promise<TestResult[]> => {
      setIsRunning(true);
      try {
        const results = await framework.runSuite(suiteId);
        return results;
      } finally {
        if (isMountedRef.current) {
          setIsRunning(false);
        }
      }
    },
    [framework],
  );

  const runCell = useCallback(
    async (row: number, col: number): Promise<TestResult[]> => {
      setIsRunning(true);
      try {
        const results = await framework.runCell(sheetId, row, col);
        return results;
      } finally {
        if (isMountedRef.current) {
          setIsRunning(false);
        }
      }
    },
    [framework, sheetId],
  );

  // ===========================================================================
  // Configuration Methods
  // ===========================================================================

  const setAutoRun = useCallback(
    (enabled: boolean): void => {
      framework.setAutoRun(enabled);
      setIsAutoRunEnabled(enabled);
    },
    [framework],
  );

  return {
    // Assertions
    assertions,
    addAssertion,
    updateAssertion,
    removeAssertion,
    getAssertionsForCell,

    // Suites
    suites,
    createSuite,
    updateSuite,
    deleteSuite,
    addAssertionsToSuite,
    removeAssertionsFromSuite,

    // Execution
    runAll,
    runSuite,
    runCell,
    isRunning,
    lastResults,
    lastSummary,

    // Configuration
    setAutoRun,
    isAutoRunEnabled,
  };
}

// Re-export types for convenience
export type {
  AssertionParams,
  AssertionSeverity,
  AssertionTarget,
  AssertionType,
  CellAssertion,
  TestResult,
  TestRunSummary,
  TestSuite,
} from '@mog/spreadsheet-testing';
