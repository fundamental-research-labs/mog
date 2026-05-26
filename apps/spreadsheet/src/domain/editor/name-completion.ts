/**
 * Named Range Completion
 *
 * Provides suggestions for defined names, tables, and sheet names
 * in formula autocomplete. Queries SpreadsheetStore for available names.
 *
 */

// =============================================================================
// Types
// =============================================================================

export type NameSuggestionType = 'definedName' | 'table' | 'tableColumn' | 'sheetName';

export interface NameSuggestion {
  /** The name to insert */
  name: string;
  /** Type of the name for icon/styling */
  type: NameSuggestionType;
  /** Scope: workbook-level or sheet-specific */
  scope: 'workbook' | 'sheet';
  /** What it refers to (for display, e.g., "Sheet1!$A$1:$B$10") */
  refersTo: string;
  /** For tableColumn, the parent table name */
  parentTable?: string;
}

/**
 * Defined name definition from SpreadsheetStore
 */
export interface DefinedNameDefinition {
  refersTo: string;
  scope?: string; // sheetId if sheet-scoped, undefined for workbook
  comment?: string;
}

/**
 * Table info from SpreadsheetStore
 */
export interface TableInfo {
  name: string;
  sheetName: string;
  range: string; // A1 notation like "A1:D10"
  columns: Array<{ name: string }>;
}

/**
 * Sheet info from SpreadsheetStore
 */
export interface SheetInfo {
  id: string;
  name: string;
}

/**
 * Minimal interface for store to avoid tight coupling.
 * The actual SpreadsheetStore has more methods, but we only need these.
 */
export interface NameCompletionStoreLike {
  getDefinedNames(): Record<string, DefinedNameDefinition>;
  getTables(): TableInfo[];
  getTable(name: string): TableInfo | undefined;
  getSheets(): SheetInfo[];
}

/**
 * Context for table reference completion
 */
export interface TableRefContext {
  /** Table name when inside a table reference like "Table1[" */
  insideTableRef?: string;
}

// =============================================================================
// Completion Functions
// =============================================================================

/**
 * Get name suggestions matching the given prefix.
 * Returns suggestions sorted by relevance (scope, type, then alphabetically).
 *
 * @param prefix - Text to match (case-insensitive)
 * @param store - Store to query for names
 * @param currentSheetId - Current sheet for scope filtering
 * @param context - Additional context (e.g., inside table reference)
 */
export function getNameSuggestions(
  prefix: string,
  store: NameCompletionStoreLike,
  currentSheetId: string,
  context?: TableRefContext,
): NameSuggestion[] {
  const suggestions: NameSuggestion[] = [];
  const prefixUpper = prefix.toUpperCase();

  // If inside a table reference like "Table1[", show column names and special items
  if (context?.insideTableRef) {
    const table = store.getTable(context.insideTableRef);
    if (table) {
      // Add column names
      for (const column of table.columns) {
        if (column.name.toUpperCase().startsWith(prefixUpper)) {
          suggestions.push({
            name: column.name,
            type: 'tableColumn',
            scope: 'workbook',
            refersTo: `[${column.name}]`,
            parentTable: table.name,
          });
        }
      }

      // Add special table items
      const specialItems = ['#All', '#Data', '#Headers', '#Totals', '#This Row'];
      for (const item of specialItems) {
        if (item.toUpperCase().startsWith(prefixUpper)) {
          suggestions.push({
            name: item,
            type: 'tableColumn',
            scope: 'workbook',
            refersTo: `[${item}]`,
            parentTable: table.name,
          });
        }
      }

      return sortSuggestions(suggestions);
    }
  }

  // Get defined names (named ranges, formulas)
  const names = store.getDefinedNames();
  for (const [name, definition] of Object.entries(names)) {
    if (name.toUpperCase().startsWith(prefixUpper)) {
      // Check scope visibility
      const isSheetScoped = definition.scope === currentSheetId;
      const isVisible = !definition.scope || isSheetScoped;

      if (isVisible) {
        suggestions.push({
          name,
          type: 'definedName',
          scope: isSheetScoped ? 'sheet' : 'workbook',
          refersTo: definition.refersTo,
        });
      }
    }
  }

  // Get table names
  const tables = store.getTables();
  for (const table of tables) {
    if (table.name.toUpperCase().startsWith(prefixUpper)) {
      suggestions.push({
        name: table.name,
        type: 'table',
        scope: 'workbook',
        refersTo: `${table.sheetName}!${table.range}`,
      });
    }
  }

  // Get sheet names (for cross-sheet references like Sheet1!A1)
  const sheets = store.getSheets();
  for (const sheet of sheets) {
    if (sheet.name.toUpperCase().startsWith(prefixUpper)) {
      // Quote sheet names with spaces or special characters
      const needsQuoting = /[^A-Za-z0-9_]/.test(sheet.name);
      const displayName = needsQuoting ? `'${sheet.name}'` : sheet.name;
      suggestions.push({
        name: displayName,
        type: 'sheetName',
        scope: 'workbook',
        refersTo: `${displayName}!`,
      });
    }
  }

  return sortSuggestions(suggestions);
}

/**
 * Sort suggestions by relevance:
 * 1. Sheet-scoped names first (more specific)
 * 2. Then by type: definedName > table > tableColumn > sheetName
 * 3. Then alphabetically
 */
function sortSuggestions(suggestions: NameSuggestion[]): NameSuggestion[] {
  const typeOrder: Record<NameSuggestionType, number> = {
    definedName: 0,
    table: 1,
    tableColumn: 2,
    sheetName: 3,
  };

  return suggestions.sort((a, b) => {
    // Sheet-scoped names first
    if (a.scope !== b.scope) {
      return a.scope === 'sheet' ? -1 : 1;
    }

    // Then by type
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }

    // Then alphabetically
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get icon character for a suggestion type (for UI display).
 */
export function getNameSuggestionIcon(type: NameSuggestionType): string {
  switch (type) {
    case 'definedName':
      return '📛'; // Named range
    case 'table':
      return '📊'; // Table
    case 'tableColumn':
      return '📋'; // Column
    case 'sheetName':
      return '📄'; // Sheet
    default:
      return '📝';
  }
}

/**
 * Format a name suggestion for display.
 * Returns the name with any necessary quoting/escaping.
 */
export function formatNameForInsertion(suggestion: NameSuggestion): string {
  switch (suggestion.type) {
    case 'tableColumn':
      // Table columns are inserted as [ColumnName]
      return `[${suggestion.name}]`;

    case 'sheetName':
      // Sheet names are inserted with ! suffix (e.g., "Sheet1!" or "'My Sheet'!")
      return `${suggestion.name}!`;

    case 'table':
    case 'definedName':
    default:
      // Tables and defined names are inserted as-is
      return suggestion.name;
  }
}

/**
 * Detect if cursor is inside a table reference.
 * Returns the table name if inside "TableName[" context.
 *
 * @param formula - The formula string
 * @param cursorPosition - Cursor position
 */
export function detectTableRefContext(
  formula: string,
  cursorPosition: number,
): TableRefContext | undefined {
  // Look backwards from cursor for an unclosed "["
  let bracketStart = -1;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < cursorPosition && i < formula.length; i++) {
    const char = formula[i];

    // Handle string literals
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar) {
      inString = false;
      continue;
    }
    if (inString) continue;

    if (char === '[') {
      bracketStart = i;
    } else if (char === ']') {
      bracketStart = -1;
    }
  }

  if (bracketStart === -1) {
    return undefined;
  }

  // Look for table name before the "["
  // Pattern: TableName[ or [@ for current row
  const beforeBracket = formula.slice(0, bracketStart);
  const tableNameMatch = beforeBracket.match(/([A-Za-z_][A-Za-z0-9_]*)$/);

  if (tableNameMatch) {
    return {
      insideTableRef: tableNameMatch[1],
    };
  }

  return undefined;
}
