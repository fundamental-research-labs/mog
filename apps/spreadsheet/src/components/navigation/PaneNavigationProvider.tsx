/**
 * Pane Navigation Provider
 *
 * Wires DOM elements to the pane navigation coordinator for F6 keyboard navigation.
 * Provides refs via context to child components so they can register themselves
 * as focusable panes (toolbar, formula bar, grid, status bar).
 *
 * ## Architecture
 *
 * This component bridges React's ref system with the pane navigation coordinator:
 * - Uses callback refs to notify coordinator when panes mount/unmount
 * - Provides refs via context so layout components can attach them
 * - Enables F6/Shift+F6 to cycle focus between registered panes
 *
 * ## F6 Navigation Behavior
 *
 * F6 cycles forward through panes:
 * Toolbar → Formula Bar → Grid → Status Bar → Toolbar (repeat)
 *
 * Shift+F6 cycles backward through panes
 *
 * ## Usage
 *
 * ```tsx
 * // In layout component:
 * <PaneNavigationProvider>
 * <SpreadsheetLayout />
 * </PaneNavigationProvider>
 *
 * // In child components:
 * const paneRefs = usePaneElementRefs();
 * <div ref={paneRefs?.toolbarRef} tabIndex={-1} data-pane="toolbar">
 * <Toolbar />
 * </div>
 * ```
 *
 */

import React, { useCallback, useMemo } from 'react';
import { usePaneNavigation } from '../../app/CoordinatorProvider';

/**
 * Props for PaneNavigationProvider component.
 */
interface PaneNavigationProviderProps {
  children: React.ReactNode;
}

/**
 * Context value for pane element refs.
 * Used by layout components to attach refs to wrapper divs.
 */
interface PaneElementsContextValue {
  toolbarRef: (el: HTMLDivElement | null) => void;
  formulaBarRef: (el: HTMLDivElement | null) => void;
  gridRef: (el: HTMLDivElement | null) => void;
  statusBarRef: (el: HTMLDivElement | null) => void;
}

/**
 * Context for pane element refs.
 * Provides callback refs to child components for registering panes.
 */
const PaneElementsContext = React.createContext<PaneElementsContextValue | null>(null);

/**
 * Hook to access pane element refs.
 * Used in layout components to wire div refs to the coordinator.
 *
 * @returns Callback refs for each pane, or null if outside provider
 *
 * @example
 * ```tsx
 * const paneRefs = usePaneElementRefs();
 * <div ref={paneRefs?.toolbarRef} tabIndex={-1} data-pane="toolbar">
 * ```
 */
export function usePaneElementRefs(): PaneElementsContextValue | null {
  return React.useContext(PaneElementsContext);
}

/**
 * Provider component that wires DOM elements to the pane navigation coordinator.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access usePaneNavigation.
 *
 * Uses callback refs on wrapper divs to register elements with the coordinator
 * for F6 pane cycling navigation.
 *
 * ## Implementation Details
 *
 * - Creates stable callback refs that notify coordinator on mount/unmount
 * - Refs are memoized with useCallback to prevent unnecessary re-renders
 * - Coordinator handles focus management and keyboard navigation
 * - Components can check data-pane attribute to identify pane type
 *
 * @param props - Component props
 * @param props.children - Child components (typically layout)
 */
export function PaneNavigationProvider({ children }: PaneNavigationProviderProps) {
  const paneNav = usePaneNavigation();

  // Create stable callback refs for pane elements
  // These notify the coordinator when panes mount/unmount
  const toolbarRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      paneNav.setToolbarElement(el);
    },
    [paneNav],
  );

  const formulaBarRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      paneNav.setFormulaBarElement(el);
    },
    [paneNav],
  );

  const gridRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      paneNav.setGridElement(el);
    },
    [paneNav],
  );

  const statusBarRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      paneNav.setStatusBarElement(el);
    },
    [paneNav],
  );

  // Memoize context value to prevent unnecessary re-renders of consumers
  const paneElementsValue = useMemo<PaneElementsContextValue>(
    () => ({
      toolbarRef: toolbarRefCallback,
      formulaBarRef: formulaBarRefCallback,
      gridRef: gridRefCallback,
      statusBarRef: statusBarRefCallback,
    }),
    [toolbarRefCallback, formulaBarRefCallback, gridRefCallback, statusBarRefCallback],
  );

  return (
    <PaneElementsContext.Provider value={paneElementsValue}>
      {children}
    </PaneElementsContext.Provider>
  );
}
