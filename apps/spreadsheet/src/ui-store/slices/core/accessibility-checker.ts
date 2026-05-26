/**
 * Accessibility Checker Slice
 *
 * Manages state for the Accessibility Checker panel, which helps users
 * find and fix accessibility issues in their workbook.
 *
 * Features:
 * - Check workbook for accessibility issues
 * - Navigate through issues by category
 * - Display fix recommendations
 * - Track selected issue for navigation
 *
 */

import type { StateCreator } from 'zustand';

import type {
  AccessibilityIssue,
  AccessibilityIssueCategory,
} from '@mog-sdk/contracts/accessibility';

// =============================================================================
// Types
// =============================================================================

/**
 * Status of the accessibility check operation.
 */
export type AccessibilityCheckStatus = 'idle' | 'checking' | 'completed';

/**
 * Accessibility Checker panel state.
 */
export interface AccessibilityCheckerState {
  /** Whether the accessibility checker panel is open */
  isOpen: boolean;
  /** Current check status */
  status: AccessibilityCheckStatus;
  /** List of accessibility issues found */
  issues: AccessibilityIssue[];
  /** Currently selected issue ID for navigation */
  selectedIssueId: string | null;
  /** Which categories are expanded in the accordion */
  expandedCategories: AccessibilityIssueCategory[];
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface AccessibilityCheckerSlice {
  /** Accessibility Checker panel state */
  accessibilityChecker: AccessibilityCheckerState;

  /** Open the Accessibility Checker panel and start checking */
  openAccessibilityPanel: () => void;

  /** Close the Accessibility Checker panel */
  closeAccessibilityPanel: () => void;

  /** Set the accessibility check status */
  setAccessibilityCheckStatus: (status: AccessibilityCheckStatus) => void;

  /** Set the list of accessibility issues found */
  setAccessibilityIssues: (issues: AccessibilityIssue[]) => void;

  /** Select an issue for navigation/highlighting */
  selectAccessibilityIssue: (issueId: string | null) => void;

  /** Set which categories are expanded */
  setExpandedCategories: (categories: AccessibilityIssueCategory[]) => void;

  /** Toggle a category's expanded state */
  toggleCategoryExpanded: (category: AccessibilityIssueCategory) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialAccessibilityCheckerState: AccessibilityCheckerState = {
  isOpen: false,
  status: 'idle',
  issues: [],
  selectedIssueId: null,
  expandedCategories: [],
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createAccessibilityCheckerSlice: StateCreator<
  AccessibilityCheckerSlice,
  [],
  [],
  AccessibilityCheckerSlice
> = (set, get) => ({
  accessibilityChecker: initialAccessibilityCheckerState,

  openAccessibilityPanel: () => {
    set({
      accessibilityChecker: {
        ...initialAccessibilityCheckerState,
        isOpen: true,
        status: 'checking',
      },
    });
  },

  closeAccessibilityPanel: () => {
    set({
      accessibilityChecker: initialAccessibilityCheckerState,
    });
  },

  setAccessibilityCheckStatus: (status) => {
    set((state) => ({
      accessibilityChecker: {
        ...state.accessibilityChecker,
        status,
      },
    }));
  },

  setAccessibilityIssues: (issues) => {
    // Auto-expand categories that have issues
    const categoriesWithIssues = [
      ...new Set(issues.map((issue) => issue.category)),
    ] as AccessibilityIssueCategory[];

    set((state) => ({
      accessibilityChecker: {
        ...state.accessibilityChecker,
        issues,
        // Auto-expand categories with issues
        expandedCategories: categoriesWithIssues,
        // Auto-select first issue if any
        selectedIssueId: issues.length > 0 ? issues[0].id : null,
        status: 'completed',
      },
    }));
  },

  selectAccessibilityIssue: (issueId) => {
    set((state) => ({
      accessibilityChecker: {
        ...state.accessibilityChecker,
        selectedIssueId: issueId,
      },
    }));
  },

  setExpandedCategories: (categories) => {
    set((state) => ({
      accessibilityChecker: {
        ...state.accessibilityChecker,
        expandedCategories: categories,
      },
    }));
  },

  toggleCategoryExpanded: (category) => {
    const state = get().accessibilityChecker;
    const isExpanded = state.expandedCategories.includes(category);

    const newCategories = isExpanded
      ? state.expandedCategories.filter((c) => c !== category)
      : [...state.expandedCategories, category];

    set({
      accessibilityChecker: {
        ...state,
        expandedCategories: newCategories,
      },
    });
  },
});
