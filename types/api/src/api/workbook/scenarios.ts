/**
 * WorkbookScenarios — Sub-API for what-if scenario operations.
 *
 * Provides namespaced access to scenario CRUD, application, and restoration.
 *
 * Usage: `workbook.scenarios.add(config)` instead of
 *        `workbook.createScenario(config)`
 */
import type {
  ActiveScenarioState,
  OriginalCellValue,
  Scenario,
  ScenarioConfig,
} from '../types';
import type { WorkbookScenarioApplyReceipt } from '../mutation-receipt';

export interface WorkbookScenarios {
  /**
   * Add a what-if scenario.
   * @param config - Scenario configuration (name, changing cells, values).
   * @returns The newly created scenario's ID.
   */
  add(config: ScenarioConfig): Promise<string>;

  /**
   * List all scenarios in the workbook.
   * @returns Array of all saved scenarios.
   */
  list(): Promise<Scenario[]>;

  /**
   * Return the session-scoped active scenario id, if a scenario is currently applied.
   */
  getActiveScenarioId(): Promise<string | null>;

  /**
   * Return session-scoped active scenario state. This is not persisted in workbook storage.
   */
  getActiveScenarioState(): Promise<ActiveScenarioState | null>;

  /**
   * Apply a scenario's values to the worksheet.
   * @param id - The scenario ID to apply.
   * @returns Result including cells updated count and original values for restore.
   */
  apply(id: string): Promise<WorkbookScenarioApplyReceipt>;

  /**
   * Restore original values from a prior apply() call and deactivate the scenario.
   * @param baselineIdOrOriginals - The Rust session baseline ID returned by apply().
   * Legacy original-value arrays are accepted by the current kernel wrapper but
   * are ignored; restore is owned by the Rust session baseline.
   */
  restore(baselineIdOrOriginals: string | OriginalCellValue[]): Promise<void>;

  /**
   * Update an existing scenario's configuration.
   * @param scenarioId - The scenario ID to update.
   * @param config - Partial configuration with fields to change.
   */
  update(scenarioId: string, config: Partial<ScenarioConfig>): Promise<void>;

  /**
   * Remove a scenario.
   * @param id - The scenario ID to remove.
   */
  remove(id: string): Promise<void>;
}
