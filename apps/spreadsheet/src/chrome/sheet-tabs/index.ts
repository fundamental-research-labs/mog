/**
 * Sheet Tabs Module
 *
 * Components for sheet tab navigation and management.
 * Moved from @mog/shell as part of Clean OS Architecture.
 */

// Main exported component
export { TabStrip } from './TabStrip';

// Sub-components (exported for potential customization)
export { MoveOrCopySheetDialog } from './MoveOrCopySheetDialog';
export type { MoveOrCopySheetDialogProps } from './MoveOrCopySheetDialog';
export { Tab } from './Tab';
export type { TabProps } from './Tab';
export { EXTENDED_TAB_COLORS, STANDARD_TAB_COLORS, TabColorPicker } from './TabColorPicker';
export type { TabColorPickerProps } from './TabColorPicker';
export { TabContextMenu } from './TabContextMenu';
export type { TabContextMenuProps } from './TabContextMenu';
export { UnhideSheetDialog } from './UnhideSheetDialog';
export type { UnhideSheetDialogProps } from './UnhideSheetDialog';
