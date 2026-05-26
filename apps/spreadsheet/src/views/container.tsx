/**
 * ViewContainer Component
 *
 * React component that mounts the active view adapter into the DOM.
 * Handles adapter lifecycle: mount on render, unmount on cleanup.
 *
 * This is a thin React wrapper around the imperative ViewAdapter API.
 */

import { useEffect, useRef } from 'react';
import { useViewAdapterById } from './hooks';
import type { ViewAdapter, ViewId } from './types';

export interface ViewContainerProps {
  /** The view adapter to mount */
  adapter: ViewAdapter | null;
  /** Optional CSS class name */
  className?: string;
}

/**
 * ViewContainer mounts a view adapter into the DOM.
 *
 * Usage:
 * ```tsx
 * const adapter = useViewAdapter(activeViewId);
 * return <ViewContainer adapter={adapter} />;
 * ```
 *
 * Lifecycle:
 * - On mount: calls adapter.mount(container)
 * - On adapter change: calls old.unmount(), then new.mount(container)
 * - On unmount: calls adapter.unmount()
 *
 * Note: unmount() is called (not dispose()) because view switching should
 * preserve adapter state. dispose() is called only when view is deleted.
 */
export function ViewContainer({ adapter, className = 'flex-1' }: ViewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adapter || !containerRef.current) {
      return;
    }

    // Mount the adapter
    adapter.mount(containerRef.current);

    // Cleanup: unmount (but don't dispose - adapter may be cached)
    return () => {
      adapter.unmount();
    };
  }, [adapter]);

  return <div ref={containerRef} className={className} />;
}

/**
 * ViewContainer variant that accepts viewId and looks up the adapter.
 * Requires a hook to resolve viewId → adapter (created in
 */
export interface ViewContainerByIdProps {
  /** View ID to render */
  viewId: ViewId;
  /** Optional CSS class name */
  className?: string;
}

/**
 * ViewContainerById looks up adapter by ID and renders it.
 *
 * This is a convenience wrapper for:
 * ```tsx
 * const adapter = useViewAdapterById(viewId);
 * return <ViewContainer adapter={adapter} />;
 * ```
 *
 * For now, viewId is treated as the view type (grid, kanban, etc.).
 * In the future, this will look up persisted view configs by ID.
 */
export function ViewContainerById({ viewId, className }: ViewContainerByIdProps) {
  const adapter = useViewAdapterById(viewId);
  return <ViewContainer adapter={adapter} className={className} />;
}
