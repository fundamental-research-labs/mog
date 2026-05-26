/**
 * Interactive Element Positions Hook
 *
 * Subscribes to the ISheetViewInteractiveElements capability and returns the
 * current list of interactive elements with their positions for DOM overlay
 * rendering.
 *
 * ## Why This Exists
 *
 * Canvas renders interactive elements (filter buttons, checkboxes, etc.) as pixels,
 * but DOM-based UI systems (Radix Popover, focus management, screen readers) need
 * real DOM elements. This hook provides the bridge between canvas coordinates and
 * React's component rendering.
 *
 * ## Performance Characteristics
 *
 * - Uses requestAnimationFrame batching (via capability) for efficient updates
 * - Only re-renders when element list changes
 * - Returns empty array when capability is null/undefined (safe defaults)
 *
 * @module hooks/use-interactive-element-positions
 * @see CANVAS-INTERACTIVE-ELEMENT-LAYER.md
 */

import { useEffect, useState } from 'react';

import type { ISheetViewInteractiveElements, InteractiveElementInfo } from '@mog-sdk/sheet-view';

/**
 * Hook that subscribes to the ISheetViewInteractiveElements capability and
 * returns the current list of interactive elements with their positions.
 *
 * @param capability - The interactive elements capability from SheetView
 * @returns Array of interactive elements with viewport-relative positions
 *
 * @example
 * ```tsx
 * const elements = useInteractiveElementPositions(
 * rendererActions.getInteractiveElements
 * );
 *
 * return elements.map(el => (
 * <div
 * key={el.id}
 * style={{
 * position: 'absolute',
 * left: el.bounds.x,
 * top: el.bounds.y,
 * width: el.bounds.width,
 * height: el.bounds.height,
 * }}
 * />
 * ));
 * ```
 */
export function useInteractiveElementPositions(
  capability: ISheetViewInteractiveElements | null | undefined,
): readonly InteractiveElementInfo[] {
  const [elements, setElements] = useState<readonly InteractiveElementInfo[]>([]);

  useEffect(() => {
    if (!capability) {
      setElements([]);
      return;
    }

    // Subscribe to capability updates
    const disposable = capability.observe(
      (snapshot: { elements: readonly InteractiveElementInfo[] }) => {
        setElements(snapshot.elements);
      },
    );

    // Get initial state
    setElements(capability.getSnapshot().elements);

    return () => {
      disposable.dispose();
    };
  }, [capability]);

  return elements;
}
