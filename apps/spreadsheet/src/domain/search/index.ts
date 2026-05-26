/**
 * Search Module
 *
 * Pure functions for searching cell values and formulas.
 * This is NOT a domain module (not Yjs-backed) - it's a read-only query system.
 *
 * ARCHITECTURE:
 * - Pure functions: no side effects, easily testable
 * - CellId-based results: survives row/col insert/delete operations
 * - Read-only: doesn't modify state (Replace is a separate mutation operation)
 * - Position is NOT stored in results - resolved at navigation/render time
 *
 * Why NOT a domain module:
 * - Search is ephemeral query state, not persistent data
 * - Domain modules are for Yjs-backed persistent state (cells, formats, merges)
 * - Search results are owned by XState machine, not Zustand/Yjs
 *
 * @see docs/architecture/cell-identity.md
 */

export {
  cellMatchesQuery,
  createMatcher,
  findAllMatches,
  formatDisplayValue,
  replaceText,
} from './search-utils';

export { searchCells, searchInScope, searchWorkbook } from './search-executor';

export type { SearchDataProvider, SearchProgressCallback } from './search-executor';
