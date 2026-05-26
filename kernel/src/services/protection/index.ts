/**
 * Protection Runtime - Extracted from @mog-sdk/contracts/protection
 *
 * Contains runtime functions for protection: password hashing, mutation result factories.
 * Types/interfaces remain in contracts.
 *
 */

import type { MutationResult } from '@mog-sdk/contracts/protection';

// =============================================================================
// Mutation Result Factory Functions
// =============================================================================

/**
 * Convenience factory for success results.
 */
export function successResult(affected?: number): MutationResult {
  return { success: true, affected };
}

/**
 * Convenience factory for protection error results.
 */
export function protectionError(reason: string): MutationResult {
  return { success: false, error: 'PROTECTED', reason };
}

/**
 * Convenience factory for invalid range error results.
 */
export function invalidRangeError(reason: string): MutationResult {
  return { success: false, error: 'INVALID_RANGE', reason };
}

/**
 * Convenience factory for sheet not found error results.
 */
export function sheetNotFoundError(sheetId: string): MutationResult {
  return { success: false, error: 'SHEET_NOT_FOUND', reason: `Sheet not found: ${sheetId}` };
}

// =============================================================================
// Password Hashing (Excel Compatibility)
// =============================================================================

/**
 * Excel's legacy XOR-based password algorithm.
 *
 * SECURITY WARNING: This is intentionally weak for Excel compatibility.
 * Excel sheet protection is NOT cryptographically secure - it's a UI-level
 * protection to prevent accidental edits, NOT security against malicious actors.
 *
 * @param password - The plaintext password
 * @returns 4-character hex hash string (Excel format)
 */
export function hashExcelPassword(password: string): string {
  if (!password) return '';

  let hash = 0;
  for (let i = password.length - 1; i >= 0; i--) {
    hash = ((hash >> 14) & 0x01) | ((hash << 1) & 0x7fff);
    hash ^= password.charCodeAt(i);
  }
  hash = ((hash >> 14) & 0x01) | ((hash << 1) & 0x7fff);
  hash ^= password.length;
  hash ^= 0xce4b;
  return hash.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Verify a password against a stored Excel hash.
 *
 * @param password - The plaintext password to verify
 * @param storedHash - The stored hash from Excel file
 * @returns true if password matches
 */
export function verifyExcelPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return true; // No password set
  if (!password) return false; // Password required but not provided
  return hashExcelPassword(password) === storedHash;
}
