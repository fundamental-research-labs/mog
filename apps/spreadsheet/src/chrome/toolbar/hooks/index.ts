/**
 * Toolbar Hooks
 *
 * Domain-specific hooks for ribbon groups. Each hook provides
 * focused state and actions for a single toolbar group.
 *
 */

// HomeRibbon hooks
// Clipboard — DELETED (Insert ribbon dispatch). Ribbon dispatches directly.
// Cells — DELETED (Insert ribbon dispatch).
// Editing — DELETED (Insert ribbon dispatch).

// Font, Alignment, Number Format, and Styles hook wrappers were deleted; every
// ribbon group's onClick now routes directly through `useDispatch` per
// ARCHITECTURE-CHECKLIST §1.

// PageLayoutRibbon hooks
// Page Layout dispatch deleted `use-page-layout-actions.ts` — every call
// site now goes through `dispatch()` (Unified Action System) and reads
// state via small focused hooks (`usePrintArea`, `usePrintSettings`,
// `usePageBreaks`, `useSheetViewOptions`).

// InsertRibbon hooks — DELETED. InsertRibbon dispatches directly.
