/**
 * Grouping Settings Operations
 *
 * Outline display settings and subscription management.
 * Settings are managed by Rust compute core; these are compatibility stubs.
 *
 * Stream O: Grouping/Outline Implementation
 *
 * Architecture Notes:
 * - No CB method for outline settings yet -- these are no-op stubs
 * - Subscriptions are handled via MutationResult event system, not CRDT observe
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type { SheetGroupingConfig } from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Settings Operations
// =============================================================================

/**
 * Update outline display settings for a sheet.
 *
 * In the ComputeBridge architecture, outline settings are managed by Rust.
 * There is no dedicated CB method for setting outline display settings yet,
 * so this is a no-op stub for API compatibility.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _settings - Outline settings to apply (unused)
 * @param _origin - Source of the change (unused)
 */
export function setOutlineSettings(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _settings: Partial<
    Pick<
      SheetGroupingConfig,
      'summaryRowsBelow' | 'summaryColumnsRight' | 'showOutlineSymbols' | 'showOutlineLevelButtons'
    >
  >,
  _origin: StructureChangeSource = 'user',
): void {
  // No-op: outline settings are managed by Rust compute core.
  // A dedicated CB method will be added when needed.
}

// =============================================================================
// Subscriptions
// =============================================================================

/**
 * Subscribe to grouping changes for a specific sheet.
 * Returns an unsubscribe function.
 *
 * In the ComputeBridge architecture, grouping change notifications come
 * through MutationResult events, not CRDT observe. This is a compatibility stub.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param callback - Called with default config immediately
 * @returns Unsubscribe function (no-op)
 */
export function subscribeToGrouping(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  callback: (config: SheetGroupingConfig) => void,
): () => void {
  // Provide initial callback with defaults
  callback({ ...DEFAULT_SHEET_GROUPING_CONFIG });

  // In the ComputeBridge architecture, change notifications come through
  // MutationResult events. This is a compatibility stub.
  return () => {};
}
