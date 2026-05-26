/**
 * Naming Utilities
 *
 * Utilities for generating unique names with conflict resolution.
 * Used for pivot tables, charts, tables, etc. when creating new worksheets.
 *
 * @module utils/naming
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Context for name generation, providing access to existing names.
 */
export interface NamingContext {
  /** Set of existing names to check against */
  existingNames: Set<string>;
}

// =============================================================================
// Unique Name Generation
// =============================================================================

/**
 * Generate a unique sheet name by appending " (2)", " (3)", etc. if needed.
 *
 * Matches Excel's behavior where conflicting names get suffixes like:
 * - "PivotTable1"
 * - "PivotTable1 (2)"
 * - "PivotTable1 (3)"
 *
 * @param baseName - The desired base name (e.g., "PivotTable1")
 * @param existingNames - Set of names that already exist
 * @returns A unique name that doesn't conflict with existing names
 *
 * @example
 * ```typescript
 * const existing = new Set(['Sheet1', 'PivotTable1', 'PivotTable1 (2)']);
 * getUniqueSheetName('Sheet1', existing); // Returns "Sheet1 (2)"
 * getUniqueSheetName('PivotTable1', existing); // Returns "PivotTable1 (3)"
 * getUniqueSheetName('NewSheet', existing); // Returns "NewSheet"
 * ```
 */
export function getUniqueSheetName(baseName: string, existingNames: Set<string>): string {
  // If base name is available, use it directly
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  // Find next available number suffix
  let counter = 2;
  while (existingNames.has(`${baseName} (${counter})`)) {
    counter++;
  }

  return `${baseName} (${counter})`;
}

/**
 * Get all sheet names from context as a Set.
 * Helper function to prepare the existingNames parameter for getUniqueSheetName.
 *
 * @param sheetOrder - Array of sheet IDs
 * @param getSheetName - Function to get sheet name from ID
 * @returns Set of all existing sheet names
 */
export function collectSheetNames(
  sheetOrder: string[],
  getSheetName: (sheetId: string) => string | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const sheetId of sheetOrder) {
    const name = getSheetName(sheetId);
    if (name) {
      names.add(name);
    }
  }
  return names;
}
