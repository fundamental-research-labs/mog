/**
 * AutoHideRibbonTrigger - Trigger strip for auto-hide ribbon mode.
 *
 * When ribbon is in auto-hide mode, this component renders a thin strip
 * at the top edge that triggers ribbon reveal on hover or click.
 *
 * Behavior matches Excel:
 * - 4px high trigger area at top edge
 * - Hover for 200ms or click reveals ribbon
 * - Moving mouse away hides ribbon (with delay)
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext } from '../../../internal-api';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';

// =============================================================================
// Constants
// =============================================================================

/** Height of the trigger strip in pixels */
const TRIGGER_HEIGHT = 4;

/** Delay before showing ribbon on hover (ms) */
const HOVER_SHOW_DELAY = 200;

/** Delay before hiding ribbon after mouse leaves (ms) */
const HIDE_DELAY = 300;

// =============================================================================
// Component
// =============================================================================

export interface AutoHideRibbonTriggerProps {
  /** Additional class names */
  className?: string;
}

/**
 * AutoHideRibbonTrigger - Thin strip at top edge to reveal auto-hidden ribbon.
 *
 * This component is only visible when displayMode is 'auto-hide'.
 * It handles hover and click interactions to show the ribbon temporarily.
 */
export function AutoHideRibbonTrigger({ className = '' }: AutoHideRibbonTriggerProps) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read state from UIStore
  const displayMode = useStore(uiStore, (s) => s.displayMode);
  const temporaryShow = useStore(uiStore, (s) => s.temporaryShow);

  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Handle mouse enter on trigger
  const handleMouseEnter = useCallback(() => {
    // Clear any pending hide
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    // Start hover show delay
    hoverTimeoutRef.current = setTimeout(() => {
      dispatch('SHOW_RIBBON_TEMPORARILY', deps);
    }, HOVER_SHOW_DELAY);
  }, [deps]);

  // Handle mouse leave from trigger (when ribbon is not shown)
  const handleMouseLeave = useCallback(() => {
    // Cancel hover show if pending
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // Handle click on trigger - immediate show
  const handleClick = useCallback(() => {
    // Clear pending hover timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    dispatch('SHOW_RIBBON_TEMPORARILY', deps);
  }, [deps]);

  // Only render in auto-hide mode when ribbon is NOT temporarily shown
  if (displayMode !== 'auto-hide' || temporaryShow) {
    return null;
  }

  return (
    <div
      className={`
 w-full cursor-pointer
 bg-transparent hover:bg-ss-primary-light/30
 transition-colors duration-ss-fast
 ${className}
 `}
      style={{ height: `${TRIGGER_HEIGHT}px` }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label="Show ribbon (hover or click)"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    />
  );
}

// =============================================================================
// Auto-hide ribbon wrapper hook
// =============================================================================

/**
 * Hook to handle hiding the ribbon when clicking outside in auto-hide mode.
 * Should be used in the parent component that wraps the ribbon.
 *
 * @param ribbonRef - Ref to the ribbon container element
 */
export function useAutoHideRibbon(ribbonRef: React.RefObject<HTMLElement | null>) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();

  const displayMode = useStore(uiStore, (s) => s.displayMode);
  const temporaryShow = useStore(uiStore, (s) => s.temporaryShow);

  useEffect(() => {
    // Only set up listener when ribbon is temporarily shown
    if (!temporaryShow || displayMode === 'full') {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;

      // Don't hide if clicked inside ribbon
      if (ribbonRef.current?.contains(target)) {
        return;
      }

      // Hide the ribbon
      dispatch('HIDE_RIBBON_TEMPORARILY', deps);
    };

    const handleMouseLeave = () => {
      // For auto-hide mode, hide when mouse leaves ribbon area
      if (displayMode === 'auto-hide') {
        // Add a small delay to allow moving back into ribbon
        setTimeout(() => {
          dispatch('HIDE_RIBBON_TEMPORARILY', deps);
        }, HIDE_DELAY);
      }
    };

    // Add listeners
    document.addEventListener('mousedown', handleClickOutside);
    ribbonRef.current?.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      ribbonRef.current?.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [temporaryShow, displayMode, ribbonRef, deps]);
}
