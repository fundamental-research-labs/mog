/**
 * Accordion - Radix UI Wrapper
 *
 * Accessible accordion component wrapping @radix-ui/react-accordion.
 * Used for collapsible content sections like the Accessibility Checker panel.
 *
 * Features:
 * - Full keyboard navigation (Arrow keys, Home, End, Space, Enter) - handled by Radix
 * - ARIA attributes for accessibility - handled by Radix
 * - Single or multiple expansion modes
 * - Animated expand/collapse with smooth transitions
 *
 * Uses semantic design tokens from tokens.css - never Tailwind defaults.
 *
 */

import * as RadixAccordion from '@radix-ui/react-accordion';
import { forwardRef, type ReactNode } from 'react';

import { cn } from './styles';

// =============================================================================
// Types
// =============================================================================

export interface AccordionRootProps {
  /** Type of accordion - single allows one item open, multiple allows many */
  type?: 'single' | 'multiple';
  /** Default expanded item(s) */
  defaultValue?: string | string[];
  /** Controlled expanded item(s) */
  value?: string | string[];
  /** Called when expanded items change */
  onValueChange?: (value: string | string[]) => void;
  /** Whether items can be collapsed in single mode */
  collapsible?: boolean;
  /** Children (AccordionItem components) */
  children: ReactNode;
  /** Additional class names */
  className?: string;
  /** Disable all items */
  disabled?: boolean;
}

export interface AccordionItemProps {
  /** Unique value for this item */
  value: string;
  /** Children (AccordionTrigger and AccordionContent) */
  children: ReactNode;
  /** Additional class names */
  className?: string;
  /** Disable this item */
  disabled?: boolean;
}

export interface AccordionTriggerProps {
  /** Trigger content (typically header text) */
  children: ReactNode;
  /** Additional class names */
  className?: string;
  /** Icon to show (defaults to chevron) */
  icon?: ReactNode;
  /** Hide the expand/collapse icon */
  hideIcon?: boolean;
}

export interface AccordionContentProps {
  /** Content to show when expanded */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

// =============================================================================
// AccordionRoot
// =============================================================================

/**
 * AccordionRoot - Container for accordion items.
 *
 * Supports two modes:
 * - `single`: Only one item can be expanded at a time
 * - `multiple`: Any number of items can be expanded
 *
 * @example
 * ```tsx
 * <AccordionRoot type="single" collapsible defaultValue="item-1">
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Section 1</AccordionTrigger>
 *     <AccordionContent>Content 1</AccordionContent>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Section 2</AccordionTrigger>
 *     <AccordionContent>Content 2</AccordionContent>
 *   </AccordionItem>
 * </AccordionRoot>
 * ```
 */
export function AccordionRoot({
  type = 'single',
  defaultValue,
  value,
  onValueChange,
  collapsible = true,
  children,
  className,
  disabled,
}: AccordionRootProps) {
  const rootClasses = cn(
    // Base styles
    'w-full',
    className,
  );

  // Radix requires different prop shapes for single vs multiple
  if (type === 'single') {
    return (
      <RadixAccordion.Root
        type="single"
        defaultValue={defaultValue as string | undefined}
        value={value as string | undefined}
        onValueChange={onValueChange as ((value: string) => void) | undefined}
        collapsible={collapsible}
        disabled={disabled}
        className={rootClasses}
      >
        {children}
      </RadixAccordion.Root>
    );
  }

  return (
    <RadixAccordion.Root
      type="multiple"
      defaultValue={defaultValue as string[] | undefined}
      value={value as string[] | undefined}
      onValueChange={onValueChange as ((value: string[]) => void) | undefined}
      disabled={disabled}
      className={rootClasses}
    >
      {children}
    </RadixAccordion.Root>
  );
}

// =============================================================================
// AccordionItem
// =============================================================================

/**
 * AccordionItem - Individual collapsible section.
 *
 * Contains an AccordionTrigger (header) and AccordionContent (body).
 */
export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ value, children, className, disabled }, ref) => {
    const itemClasses = cn(
      // Border between items
      'border-b border-ss-border',
      // Last item has no bottom border
      'last:border-b-0',
      className,
    );

    return (
      <RadixAccordion.Item ref={ref} value={value} disabled={disabled} className={itemClasses}>
        {children}
      </RadixAccordion.Item>
    );
  },
);

AccordionItem.displayName = 'AccordionItem';

// =============================================================================
// AccordionTrigger
// =============================================================================

/**
 * AccordionTrigger - Clickable header that toggles the accordion item.
 *
 * Includes a chevron icon that rotates when expanded.
 * Fully keyboard accessible - Space/Enter to toggle.
 */
export const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ children, className, icon, hideIcon = false }, ref) => {
    const triggerClasses = cn(
      // Layout
      'flex flex-1 items-center justify-between',
      // Sizing
      'w-full py-3 px-2',
      // Typography
      'text-body font-medium text-ss-text',
      // Interaction
      'cursor-pointer',
      'outline-none',
      // Hover state
      'hover:bg-ss-bg-hover',
      // Focus ring
      'focus-visible:ring-2 focus-visible:ring-ss-border-focus focus-visible:ring-inset',
      // Transition
      'transition-colors duration-ss-fast',
      className,
    );

    const iconClasses = cn(
      // Size
      'h-4 w-4',
      // Color
      'text-ss-text-secondary',
      // Rotation animation
      'shrink-0 transition-transform duration-ss',
      // Rotate when open
      'group-data-[state=open]:rotate-180',
    );

    const defaultIcon = (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClasses}
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );

    return (
      <RadixAccordion.Header className="flex">
        <RadixAccordion.Trigger ref={ref} className={cn(triggerClasses, 'group')}>
          {children}
          {!hideIcon && (icon || defaultIcon)}
        </RadixAccordion.Trigger>
      </RadixAccordion.Header>
    );
  },
);

AccordionTrigger.displayName = 'AccordionTrigger';

// =============================================================================
// AccordionContent
// =============================================================================

/**
 * AccordionContent - Collapsible content area.
 *
 * Animates height on expand/collapse using Radix data attributes.
 */
export const AccordionContent = forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ children, className }, ref) => {
    const contentClasses = cn(
      // Animation
      'overflow-hidden',
      'data-[state=open]:animate-accordion-down',
      'data-[state=closed]:animate-accordion-up',
      className,
    );

    const innerClasses = cn(
      // Padding for content
      'px-2 pb-3 pt-0',
      // Text
      'text-body-sm text-ss-text',
    );

    return (
      <RadixAccordion.Content ref={ref} className={contentClasses}>
        <div className={innerClasses}>{children}</div>
      </RadixAccordion.Content>
    );
  },
);

AccordionContent.displayName = 'AccordionContent';
