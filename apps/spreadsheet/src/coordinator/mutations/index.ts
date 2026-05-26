/**
 * Mutations Module Index
 *
 * Barrel export for all mutation modules. Each module handles a specific
 * domain of write operations, ensuring consistent patterns for:
 * - Undo descriptions via workbook.setPendingUndoDescription()
 * - Event emission via workbook.emit()
 * - CRDT-safe operations through proper Yjs handling
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 3, 7)
 */

// Types shared across mutation modules
export * from './types';

// Sheet and workbook mutations
// (protection.ts deleted — all callers migrated to ws.canEditCell() etc.)

// Floating object mutations
// (drawings.ts and text-effects.ts deleted — all callers migrated to ws.* APIs)

// Data feature mutations
// (filters.ts deleted — all callers migrated to ws.* filter API)
export * as Tables from './tables';
