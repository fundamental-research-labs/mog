/**
 * Radix UI Wrapper Components
 *
 * This directory contains wrappers around Radix UI primitives that:
 * 1. Match our existing component APIs for drop-in compatibility
 * 2. Use our semantic design tokens (not Tailwind defaults)
 * 3. Provide battle-tested accessibility and behavior
 *
 * Philosophy: "Solve Once, Not Forever" - Radix has already solved these
 * UI patterns for thousands of production apps. We use their solution.
 *
 */

// Shared styles for all Radix wrappers
export * from './styles';

// Accordion (Accessibility Checker feature)
export {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  type AccordionContentProps,
  type AccordionItemProps,
  type AccordionRootProps,
  type AccordionTriggerProps,
} from './Accordion';

// Tabs
export { TabPanel, Tabs, type Tab, type TabPanelProps, type TabsProps } from './Tabs';

// Checkbox
export { Checkbox, type CheckboxProps } from './Checkbox';

// RadioGroup
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup';

// SegmentedControl (single-choice horizontal pill group, built on RadioGroup primitive)
export {
  SegmentedControl,
  type SegmentedControlOption,
  type SegmentedControlProps,
} from './SegmentedControl';

// Switch (toggle switch primitive)
export { Switch, type SwitchProps } from './Switch';

// Select
export { Select, type SelectProps, type SelectOption } from './Select';

// Dialog
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
} from './Dialog';

// NOTE: MinimizableDialog moved to @mog/spreadsheet (depends on UIStore dialog stack)

// Tooltip
export { Tooltip, TooltipProvider, type TooltipProps, type TooltipProviderProps } from './Tooltip';

// Popover
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  createVirtualRef,
  usePopoverClose,
  useVirtualRef,
  type InteractOutsideEvent,
  type Measurable,
  type PointerDownOutsideEvent,
  type PopoverAnchorProps,
  type PopoverCloseProps,
  type PopoverContentProps,
  type PopoverProps,
  type PopoverTriggerProps,
} from './Popover';

// Dropdown Menu
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
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
  type DropdownMenuLabelProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuSubContentProps,
  type DropdownMenuSubTriggerProps,
} from './DropdownMenu';

// ContextMenu
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
} from './ContextMenu';
