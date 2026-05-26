/**
 * Test Store - In-memory persistence for assertions and test suites
 *
 * Stores testing configuration in plain Maps.
 * Previously backed by Yjs; now uses plain TypeScript data structures
 * after the Yjs elimination.
 *
 * Structure:
 *   assertions: Map<assertionId, CellAssertion>
 *   suites: Map<suiteId, TestSuite>
 *   config: Map<string, unknown>
 */

import type {
  CellAssertion,
  TestResult,
  TestRunSummary,
  TestSuite,
} from '@mog-sdk/contracts/testing';

/**
 * Generate a unique ID
 */
function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * TestStore - manages assertions and test suites using plain Maps
 */
export class TestStore {
  private assertions: Map<string, CellAssertion>;
  private suites: Map<string, TestSuite>;
  private config: Map<string, unknown>;

  // Observer support (replaces Yjs .observe()/.unobserve())
  private assertionObservers: Set<() => void> = new Set();
  private suiteObservers: Set<() => void> = new Set();

  constructor() {
    this.assertions = new Map();
    this.suites = new Map();
    this.config = new Map();
  }

  // ===========================================================================
  // Internal Notification
  // ===========================================================================

  private notifyAssertionObservers(): void {
    for (const observer of this.assertionObservers) {
      try {
        observer();
      } catch (error) {
        console.error('[TestStore] Error in assertion observer:', error);
      }
    }
  }

  private notifySuiteObservers(): void {
    for (const observer of this.suiteObservers) {
      try {
        observer();
      } catch (error) {
        console.error('[TestStore] Error in suite observer:', error);
      }
    }
  }

  // ===========================================================================
  // Assertions CRUD
  // ===========================================================================

  /**
   * Add a new assertion
   */
  addAssertion(assertion: Omit<CellAssertion, 'id'>): CellAssertion {
    const id = generateId('assert');
    const timestamp = Date.now();
    const full: CellAssertion = {
      ...assertion,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.assertions.set(id, full);
    this.notifyAssertionObservers();

    return full;
  }

  /**
   * Update an existing assertion
   */
  updateAssertion(id: string, updates: Partial<CellAssertion>): void {
    const existing = this.assertions.get(id);

    if (!existing) return;

    this.assertions.set(id, {
      ...existing,
      ...updates,
      id, // Preserve ID
      updatedAt: Date.now(),
    });
    this.notifyAssertionObservers();
  }

  /**
   * Remove an assertion
   */
  removeAssertion(id: string): void {
    this.assertions.delete(id);

    // Also remove from any suites
    for (const [suiteId, suite] of this.suites) {
      if (suite.assertionIds.includes(id)) {
        const newAssertionIds = suite.assertionIds.filter((aid) => aid !== id);
        this.suites.set(suiteId, {
          ...suite,
          assertionIds: newAssertionIds,
          updatedAt: Date.now(),
        });
      }
    }

    this.notifyAssertionObservers();
    this.notifySuiteObservers();
  }

  /**
   * Get an assertion by ID
   */
  getAssertion(id: string): CellAssertion | undefined {
    return this.assertions.get(id);
  }

  /**
   * Get all assertions for a specific cell
   */
  getAssertionsForCell(sheetId: string, row: number, col: number): CellAssertion[] {
    const results: CellAssertion[] = [];

    for (const assertion of this.assertions.values()) {
      const target = assertion.target;

      if (target.type === 'cell') {
        if (target.sheetId === sheetId && target.row === row && target.col === col) {
          results.push(assertion);
        }
      } else {
        // Range - check if cell is within range
        if (
          target.sheetId === sheetId &&
          row >= target.startRow &&
          row <= target.endRow &&
          col >= target.startCol &&
          col <= target.endCol
        ) {
          results.push(assertion);
        }
      }
    }

    return results;
  }

  /**
   * Get all assertions
   */
  getAllAssertions(): CellAssertion[] {
    return Array.from(this.assertions.values());
  }

  // ===========================================================================
  // Test Suites CRUD
  // ===========================================================================

  /**
   * Create a new test suite
   */
  createSuite(name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>): TestSuite {
    const id = generateId('suite');
    const timestamp = Date.now();
    const suite: TestSuite = {
      id,
      name,
      assertionIds: [],
      autoRun: false,
      blockOnFailure: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...options,
    };

    this.suites.set(id, suite);
    this.notifySuiteObservers();

    return suite;
  }

  /**
   * Update an existing suite
   */
  updateSuite(id: string, updates: Partial<TestSuite>): void {
    const existing = this.suites.get(id);

    if (!existing) return;

    this.suites.set(id, {
      ...existing,
      ...updates,
      id, // Preserve ID
      updatedAt: Date.now(),
    });
    this.notifySuiteObservers();
  }

  /**
   * Delete a suite
   */
  deleteSuite(id: string): void {
    this.suites.delete(id);
    this.notifySuiteObservers();
  }

  /**
   * Get a suite by ID
   */
  getSuite(id: string): TestSuite | undefined {
    return this.suites.get(id);
  }

  /**
   * Get all suites
   */
  listSuites(): TestSuite[] {
    return Array.from(this.suites.values());
  }

  /**
   * Add assertions to a suite
   */
  addAssertionsToSuite(suiteId: string, assertionIds: string[]): void {
    const suite = this.suites.get(suiteId);

    if (!suite) return;

    // Filter to only existing assertions
    const existingIds = new Set(this.getAllAssertions().map((a) => a.id));
    const validIds = assertionIds.filter((id) => existingIds.has(id));

    // Merge with existing, avoiding duplicates
    const currentIds = new Set(suite.assertionIds);
    const newIds = [...suite.assertionIds];
    for (const id of validIds) {
      if (!currentIds.has(id)) {
        newIds.push(id);
      }
    }

    this.suites.set(suiteId, {
      ...suite,
      assertionIds: newIds,
      updatedAt: Date.now(),
    });
    this.notifySuiteObservers();
  }

  /**
   * Remove assertions from a suite
   */
  removeAssertionsFromSuite(suiteId: string, assertionIds: string[]): void {
    const suite = this.suites.get(suiteId);

    if (!suite) return;

    const idsToRemove = new Set(assertionIds);
    const newIds = suite.assertionIds.filter((id) => !idsToRemove.has(id));

    this.suites.set(suiteId, {
      ...suite,
      assertionIds: newIds,
      updatedAt: Date.now(),
    });
    this.notifySuiteObservers();
  }

  /**
   * Store results for a suite
   */
  storeSuiteResults(suiteId: string, results: TestResult[], summary: TestRunSummary): void {
    const suite = this.suites.get(suiteId);

    if (!suite) return;

    this.suites.set(suiteId, {
      ...suite,
      lastRun: Date.now(),
      lastResults: results,
      lastSummary: summary,
      updatedAt: Date.now(),
    });
    this.notifySuiteObservers();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Set auto-run configuration
   */
  setAutoRunEnabled(enabled: boolean): void {
    this.config.set('autoRunEnabled', enabled);
  }

  /**
   * Get auto-run configuration
   */
  isAutoRunEnabled(): boolean {
    return (this.config.get('autoRunEnabled') as boolean) ?? false;
  }

  // ===========================================================================
  // Observers
  // ===========================================================================

  /**
   * Subscribe to assertion changes
   */
  onAssertionsChanged(callback: () => void): () => void {
    this.assertionObservers.add(callback);
    return () => this.assertionObservers.delete(callback);
  }

  /**
   * Subscribe to suite changes
   */
  onSuitesChanged(callback: () => void): () => void {
    this.suiteObservers.add(callback);
    return () => this.suiteObservers.delete(callback);
  }
}

/**
 * Create a test store
 *
 * @deprecated The `doc` parameter is ignored. TestStore no longer uses Yjs.
 * Use `new TestStore()` directly or call `createTestStore()` with no arguments.
 */
export function createTestStore(_doc?: unknown): TestStore {
  return new TestStore();
}
