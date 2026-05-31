/**
 * Tabs - Radix UI Wrapper
 *
 * Accessible tab component wrapping @radix-ui/react-tabs.
 * Provides the same API as the old custom Tabs component for drop-in replacement.
 *
 * Features:
 * - Full keyboard navigation (Arrow keys, Home, End) - handled by Radix
 * - ARIA attributes for accessibility - handled by Radix
 * - Size variants (sm/md) for different contexts
 * - Disabled tab support
 *
 * Uses semantic design tokens from tokens.css - never Tailwind defaults.
 *
 */

import * as RadixTabs from '@radix-ui/react-tabs';
import { type ReactNode } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label - string or ReactNode for custom content (icons, badges, etc.) */
  label: ReactNode;
  /** Disable this tab */
  disabled?: boolean;
  /** Optional title attribute for tooltip on hover */
  title?: string;
  /** Optional additional class names for this trigger */
  className?: string;
}

export interface TabsProps {
  /** Tab definitions */
  tabs: Tab[];
  /** Currently active tab id */
  activeTab: string;
  /** Called when active tab changes */
  onTabChange: (id: string) => void;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional class names for the tab list container */
  className?: string;
  /** Accessible label for the tab list */
  ariaLabel?: string;
  /** TabPanel children */
  children?: ReactNode;
}

export interface TabPanelProps {
  /** Tab id this panel corresponds to */
  tabId: string;
  /** Panel content */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

// =============================================================================
// Tabs Component
// =============================================================================

/**
 * Tabs - Accessible tab list with keyboard navigation.
 *
 * Wraps Radix UI Tabs which implements the WAI-ARIA Tabs pattern:
 * - Arrow Left/Right: Navigate between tabs
 * - Home: Go to first tab
 * - End: Go to last tab
 * - Tab order only includes active tab (roving tabindex)
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useState('page');
 *
 * <Tabs
 *   tabs={[
 *     { id: 'page', label: 'Page' },
 *     { id: 'margins', label: 'Margins' },
 *     { id: 'sheet', label: 'Sheet', disabled: true },
 *   ]}
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 * >
 *   <TabPanel tabId="page">
 *     Page content here
 *   </TabPanel>
 *   <TabPanel tabId="margins">
 *     Margins content here
 *   </TabPanel>
 * </Tabs>
 * ```
 */
export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  size = 'md',
  className = '',
  ariaLabel,
  children,
}: TabsProps) {
  // Size-specific styles using semantic tokens
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-caption', // 12px - compact variant
    md: 'px-4 py-2 text-tab', // 12px - standard variant (tab-specific sizing)
  };

  const listClasses = ['flex border-b border-ss-border', className].filter(Boolean).join(' ');

  return (
    <RadixTabs.Root value={activeTab} onValueChange={onTabChange}>
      <RadixTabs.List className={listClasses} aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const triggerClasses = [
            // Base styles
            'relative border-none bg-transparent cursor-pointer font-medium',
            'transition-colors duration-ss-fast',
            'outline-none -mb-px', // Overlap border
            // Size variant
            sizeStyles[size],
            // Border bottom for active state indicator
            'border-b-2',
            // Active state (using Radix data attributes)
            'data-[state=active]:text-ss-primary data-[state=active]:border-b-ss-primary',
            // Inactive state
            'data-[state=inactive]:text-ss-text-secondary data-[state=inactive]:border-b-transparent',
            'data-[state=inactive]:hover:text-ss-text',
            // Disabled state
            'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
            'data-[disabled]:hover:text-ss-text-secondary',
            // Focus visible ring
            'focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1',
            // Per-tab custom classes
            tab.className,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <RadixTabs.Trigger
              key={tab.id}
              value={tab.id}
              disabled={tab.disabled}
              className={triggerClasses}
              title={tab.title}
              onClick={(event) => {
                if (event.defaultPrevented || tab.disabled || activeTab === tab.id) return;
                onTabChange(tab.id);
              }}
            >
              {tab.label}
            </RadixTabs.Trigger>
          );
        })}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

// =============================================================================
// TabPanel Component
// =============================================================================

/**
 * TabPanel - Container for tab content with proper ARIA attributes.
 *
 * Radix handles the visibility - only the active panel is rendered.
 * This is important for:
 * - Performance (inactive panels don't render)
 * - Form state (inactive forms don't interfere)
 *
 * @example
 * ```tsx
 * <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
 *   <TabPanel tabId="settings">
 *     <SettingsForm />
 *   </TabPanel>
 * </Tabs>
 * ```
 */
export function TabPanel({ tabId, children, className = '' }: TabPanelProps) {
  const panelClasses = ['outline-none', className].filter(Boolean).join(' ');

  return (
    <RadixTabs.Content value={tabId} className={panelClasses} tabIndex={0}>
      {children}
    </RadixTabs.Content>
  );
}
