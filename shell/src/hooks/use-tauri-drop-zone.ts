import { getCurrentWebview } from '@tauri-apps/api/webview';
import { RefObject, useEffect, useState } from 'react';

export interface TauriDropZoneOptions {
  /** Ref to the container element for bounds checking */
  containerRef: RefObject<HTMLElement | null>;
  /** Callback when files are dropped within the container bounds */
  onDrop: (paths: string[]) => void | Promise<void>;
  /** Whether the drop zone is disabled */
  disabled?: boolean;
}

/**
 * Hook for handling Tauri webview file drops with bounds checking.
 * Returns whether files are being dragged over the container.
 */
export function useTauriDropZone(options: TauriDropZoneOptions): boolean {
  const { containerRef, onDrop, disabled = false } = options;
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (disabled) return;

    let unlisten: (() => void) | undefined;
    let isMounted = true;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        const container = containerRef.current;
        if (!container) return;

        // 'leave' type doesn't have position
        if (payload.type === 'leave') {
          setIsDragOver(false);
          return;
        }

        // Check if the event position is within container bounds
        const rect = container.getBoundingClientRect();
        const isInBounds =
          payload.position.x >= rect.left &&
          payload.position.x <= rect.right &&
          payload.position.y >= rect.top &&
          payload.position.y <= rect.bottom;

        if (payload.type === 'over' || payload.type === 'enter') {
          setIsDragOver(isInBounds);
        } else if (payload.type === 'drop') {
          setIsDragOver(false);
          if (isInBounds && payload.paths.length > 0) {
            void onDrop(payload.paths);
          }
        }
      })
      .then((fn) => {
        if (isMounted) {
          unlisten = fn;
        } else {
          // Component unmounted before listener was set up - clean up immediately
          fn();
        }
      })
      .catch((err) => {
        // Tauri API might not be available in dev browser mode
        console.warn('[useTauriDropZone] Failed to set up drag-drop listener:', err);
      });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [containerRef, onDrop, disabled]);

  return isDragOver;
}
