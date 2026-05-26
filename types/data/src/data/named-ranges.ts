/**
 * Named Ranges (Defined Names) Contracts
 *
 * Type definitions for the named ranges system (Stream B1).
 *
 * CRITICAL ARCHITECTURE DECISION: Named ranges MUST use IdentityFormula
 * for the refersTo field, NOT A1 strings. This ensures:
 * - CRDT-safe storage (concurrent structure changes compose correctly)
 * - Insert/delete row/col operations don't corrupt named ranges
 * - Display regenerated at render time from stable CellIds
 *
 * @example
 * User creates "SalesData" → =Sheet1!$A$1:$B$10
 *
 * With A1 string storage (WRONG):
 *   refersTo: "=Sheet1!$A$1:$B$10"
 *   After concurrent column insert at A: still "=Sheet1!$A$1:$B$10" ❌
 *
 * With IdentityFormula storage (CORRECT):
 *   refersTo: { template: "{0}", refs: [{ startId, endId }] }
 *   After column insert: CellIds unchanged, positions shifted
 *   Display regenerates: "=Sheet1!$B$1:$C$10" ✓
 *
 */

import type { IdentityFormula } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';

// =============================================================================
// Core Types
// =============================================================================

/**
 * A defined name stored in Yjs.
 *
 * Uses IdentityFormula for CRDT-safe structure-change handling.
 * This is the same approach used for formula storage throughout the codebase.
 */
export interface DefinedName {
  /** Unique identifier for the defined name */
  id: string;

  /**
   * The name (e.g., "SalesData", "TaxRate").
   * Case-insensitive for lookup, but preserves original case.
   */
  name: string;

  /**
   * What the name refers to - stored as IdentityFormula for CRDT safety.
   *
   * Examples:
   * - Range: { template: "{0}", refs: [{ type: 'range', startId: '...', endId: '...' }] }
   * - Cell: { template: "{0}", refs: [{ type: 'cell', id: '...' }] }
   * - Constant: { template: "42", refs: [] }
   * - Formula: { template: "OFFSET({0},0,0,COUNTA({1}),1)", refs: [...] }
   */
  refersTo: IdentityFormula;

  /**
   * Scope of the name:
   * - undefined/null = workbook scope (available everywhere)
   * - sheetId = sheet scope (only available in that sheet)
   *
   * Sheet-scoped names have higher precedence than workbook-scoped
   * names with the same name.
   */
  scope?: SheetId;

  /** Optional comment/description */
  comment?: string;

  /**
   * Whether the name is visible in Name Manager.
   * Hidden names (visible: false) are typically system-generated.
   * @default true
   */
  visible?: boolean;
}

/**
 * Input for creating or updating a defined name.
 *
 * User provides A1 string, domain module converts to IdentityFormula internally.
 * This keeps the API simple while maintaining CRDT safety in storage.
 */
export interface DefinedNameInput {
  /** The name to define */
  name: string;

  /**
   * A1-style reference that will be converted to IdentityFormula.
   * Examples:
   * - "=Sheet1!$A$1:$B$10"
   * - "=$A$1"
   * - "=42" (constant)
   * - "=OFFSET(A1,0,0,COUNTA(A:A),1)" (dynamic formula)
   */
  refersToA1: string;

  /** Scope: undefined = workbook, sheetId = sheet-local */
  scope?: SheetId;

  /** Optional comment */
  comment?: string;
}

// =============================================================================
// Name Validation
// =============================================================================

/**
 * Result of name validation.
 */
export interface NameValidationResult {
  /** Whether the name is valid */
  valid: boolean;

  /** Error type if invalid */
  error?:
    | 'invalid_characters'
    | 'starts_with_number'
    | 'reserved_name'
    | 'duplicate_name'
    | 'too_long'
    | 'cell_reference'
    | 'r1c1_reference'
    | 'empty';

  /** Human-readable error message */
  message?: string;
}
