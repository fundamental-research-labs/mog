/**
 * UI Primitives
 *
 * Base UI components used across the spreadsheet application.
 * Components are built on Radix UI primitives for battle-tested accessibility and behavior.
 *
 * @example
 * ```tsx
 * import { Button, Input, Dialog, DialogHeader, DialogBody, DialogFooter } from '../ui';
 *
 * function MyDialog() {
 *   return (
 *     <Dialog open={isOpen} onOpenChange={setIsOpen}>
 *       <DialogHeader onClose={() => setIsOpen(false)}>Settings</DialogHeader>
 *       <DialogBody>
 *         <FormField label="Name" required>
 *           <Input value={name} onChange={handleNameChange} />
 *         </FormField>
 *       </DialogBody>
 *       <DialogFooter>
 *         <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
 *         <Button variant="primary" onClick={handleSave}>Save</Button>
 *       </DialogFooter>
 *     </Dialog>
 *   );
 * }
 * ```
 */

// Basic form elements
export { Button } from './Button';
// NOTE: CollapsibleRangeInput moved to @mog/spreadsheet (depends on UIStore)
export { ColorInput } from './ColorInput';
export { Input } from './Input';
export { Label } from './Label';
export { Checkbox, type CheckboxProps } from './radix/Checkbox';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './radix/RadioGroup';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Textarea } from './Textarea';

// Dialog (Radix-based)
export {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTable,
  DialogTableRow,
  DialogToolbar,
  type DialogBodyProps,
  type DialogFooterProps,
  type DialogHeaderProps,
  type DialogProps,
} from './radix/Dialog';

// NOTE: MinimizableDialog moved to @mog/spreadsheet (depends on UIStore dialog stack)

// Tabs (Radix-based)
export { TabPanel, Tabs, type Tab, type TabPanelProps, type TabsProps } from './radix/Tabs';

// Accordion (Radix-based - for collapsible sections)
export {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  type AccordionContentProps,
  type AccordionItemProps,
  type AccordionRootProps,
  type AccordionTriggerProps,
} from './radix/Accordion';

// Tooltip (Radix-based)
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipProviderProps,
} from './radix/Tooltip';

// Popover (Radix-based - fixes nested portal bug)
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  createVirtualRef,
  usePopoverClose,
  useVirtualRef,
  type Measurable,
  type PopoverAnchorProps,
  type PopoverCloseProps,
  type PopoverContentProps,
  type PopoverProps,
  type PopoverTriggerProps,
} from './radix/Popover';

// DropdownMenu (Radix-based - fixes submenu click bug)
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
} from './radix/DropdownMenu';

// ContextMenu (Radix-based - automatic keyboard nav, proper nested portal handling)
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  type ContextMenuCheckboxItemProps,
  type ContextMenuContentProps,
  type ContextMenuItemProps,
  type ContextMenuLabelProps,
  type ContextMenuRadioGroupProps,
  type ContextMenuRadioItemProps,
  type ContextMenuSeparatorProps,
  type ContextMenuSubContentProps,
  type ContextMenuSubTriggerProps,
} from './radix/ContextMenu';

// Standalone menu items (for use in Popovers/panels without DropdownMenu context)
export { MenuItem, MenuSeparator, type MenuItemProps, type MenuSeparatorProps } from './MenuItem';

// Listbox (WAI-ARIA single-select with roving tabindex)
export {
  Listbox,
  type ListboxItem,
  type ListboxItemRenderState,
  type ListboxProps,
} from './Listbox';

// Other components
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { FormField } from './FormField';

// Icons
export { Icon } from './Icon';
export type { IconName, IconProps, IconSize } from './Icon';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

// Picker primitives
export { ColorSwatch, isLightColor } from './ColorSwatch';
export { SectionLabel } from './SectionLabel';

// Status indicators
export { ConnectionBadge, StatusBadge } from './StatusBadge';
export type {
  BadgeStatus,
  ConnectionBadgeProps,
  ConnectionStatusType,
  StatusBadgeProps,
} from './StatusBadge';

// Switch — toggle switch primitive (Radix-based)
export { Switch, type SwitchProps } from './radix/Switch';

// SegmentedControl — horizontal pill-group (Radix-based, single-choice radio semantics)
export {
  SegmentedControl,
  type SegmentedControlOption,
  type SegmentedControlProps,
} from './radix/SegmentedControl';

// Utility functions
export { cn } from './radix/styles';
