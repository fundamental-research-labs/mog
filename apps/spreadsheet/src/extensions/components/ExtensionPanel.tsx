/**
 * Extension Panel
 *
 * Main container component for the extension system.
 * Provides a resizable side panel that hosts extension iframes.
 *
 * Features:
 * - Resizable via drag handle
 * - Collapsible/expandable
 * - Tab bar for multiple extensions
 * - Loading/error/disconnected states
 * - Security indicator
 *
 * @module extensions/components/ExtensionPanel
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, RESIZE_HANDLE_WIDTH } from '../constants';
import type { ExtensionInstance } from '../types';
import { ExtensionStatusBadge } from './ExtensionStatusBadge';
import { ExtensionTabs } from './ExtensionTabs';

// =============================================================================
// Types
// =============================================================================

interface ExtensionPanelProps {
  /** Whether the panel is visible */
  visible: boolean;
  /** Current panel width in pixels */
  width: number;
  /** Whether the panel is currently being resized */
  isResizing: boolean;
  /** List of extension instances */
  extensions: ExtensionInstance[];
  /** Currently active extension ID */
  activeExtensionId: string | null;
  /** Callback when visibility changes */
  onVisibilityChange: (visible: boolean) => void;
  /** Callback when width changes (during and after resize) */
  onWidthChange: (width: number) => void;
  /** Callback when resize starts/ends */
  onResizeChange: (isResizing: boolean) => void;
  /** Callback when an extension tab is selected */
  onSelectExtension: (extensionId: string) => void;
  /** Callback to retry failed extension connection */
  onRetryExtension?: (extensionId: string) => void;
  /** Children to render in the content area (typically ExtensionHost) */
  children?: ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export function ExtensionPanel({
  visible,
  width,
  isResizing,
  extensions,
  activeExtensionId,
  onVisibilityChange,
  onWidthChange,
  onResizeChange,
  onSelectExtension,
  onRetryExtension,
  children,
}: ExtensionPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Get active extension
  const activeExtension = extensions.find((ext) => ext.manifest.id === activeExtensionId);

  // Handle close button click
  const handleClose = useCallback(() => {
    onVisibilityChange(false);
  }, [onVisibilityChange]);

  // Handle retry for failed extension
  const handleRetry = useCallback(() => {
    if (activeExtensionId && onRetryExtension) {
      onRetryExtension(activeExtensionId);
    }
  }, [activeExtensionId, onRetryExtension]);

  // Resize handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      onResizeChange(true);
    },
    [width, onResizeChange],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate new width (dragging left increases width)
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, startWidthRef.current + delta),
      );
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      onResizeChange(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onWidthChange, onResizeChange]);

  // Render content based on state
  const renderContent = () => {
    if (!activeExtension) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-ss-text-secondary text-center">
          <div className="text-5xl mb-4 opacity-50">📦</div>
          <div className="text-body-lg font-semibold mb-2 text-ss-text">No Extension Selected</div>
          <div className="text-label leading-normal max-w-[240px]">
            Select an extension from the tabs above, or install extensions to get started.
          </div>
        </div>
      );
    }

    if (activeExtension.state === 'loading' || activeExtension.state === 'handshaking') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-ss-text-secondary">
          <div className="w-8 h-8 border-[3px] border-ss-border-light border-t-ss-primary rounded-full animate-spin mb-4" />
          <div>
            {activeExtension.state === 'loading' ? 'Loading extension...' : 'Connecting...'}
          </div>
        </div>
      );
    }

    if (activeExtension.state === 'error') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-ss-error text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <div className="text-body-lg font-semibold mb-2">Connection Error</div>
          <div className="text-label leading-normal mb-4 max-w-[280px] text-ss-text-secondary">
            {activeExtension.error || 'Failed to connect to the extension.'}
          </div>
          {onRetryExtension && (
            <button
              className="px-4 py-2 border-none rounded-ss-md bg-ss-primary text-ss-text-inverse text-label font-medium cursor-pointer hover:bg-ss-primary-hover"
              onClick={handleRetry}
            >
              Retry Connection
            </button>
          )}
        </div>
      );
    }

    if (activeExtension.state === 'disconnected') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-ss-error text-center">
          <div className="text-5xl mb-4">🔌</div>
          <div className="text-body-lg font-semibold mb-2">Disconnected</div>
          <div className="text-label leading-normal mb-4 max-w-[280px] text-ss-text-secondary">
            The extension connection was lost. Try refreshing the connection.
          </div>
          {onRetryExtension && (
            <button
              className="px-4 py-2 border-none rounded-ss-md bg-ss-primary text-ss-text-inverse text-label font-medium cursor-pointer hover:bg-ss-primary-hover"
              onClick={handleRetry}
            >
              Reconnect
            </button>
          )}
        </div>
      );
    }

    // Ready state - render children (ExtensionHost)
    return children;
  };

  return (
    <div
      ref={containerRef}
      className={`absolute top-0 right-0 bottom-0 flex flex-row bg-ss-surface shadow-[-2px_0_8px_rgba(0,0,0,0.1)] z-ss-sticky transition-transform duration-ss ease-out ${
        !visible ? 'translate-x-full pointer-events-none' : ''
      } ${isResizing ? 'transition-none select-none' : ''}`}
      style={{ width }}
      aria-hidden={!visible}
      role="complementary"
      aria-label="Extension Panel"
    >
      {/* Resize Handle */}
      <div
        className={`absolute top-0 left-0 bottom-0 cursor-col-resize bg-transparent z-ss-sticky transition-colors duration-ss ${
          isHandleHovered && !isResizing ? 'bg-ss-surface-hover' : ''
        } ${isResizing ? 'bg-ss-primary/20' : ''}`}
        style={{ width: RESIZE_HANDLE_WIDTH }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHandleHovered(true)}
        onMouseLeave={() => setIsHandleHovered(false)}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-label="Resize extension panel"
      >
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-ss-sm bg-ss-border transition-colors duration-ss ${
            isHandleHovered || isResizing ? 'bg-ss-primary' : ''
          }`}
        />
      </div>

      {/* Panel Content */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ marginLeft: RESIZE_HANDLE_WIDTH }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-ss-border-light bg-ss-surface-secondary min-h-[44px]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-body-sm font-semibold text-ss-text overflow-hidden text-ellipsis whitespace-nowrap">
              {activeExtension?.manifest.name || 'Extensions'}
            </span>
            {activeExtension && (
              <ExtensionStatusBadge
                state={activeExtension.state}
                error={activeExtension.error}
                showSecureBadge
                onRetry={onRetryExtension ? handleRetry : undefined}
                size="small"
              />
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              className="flex items-center justify-center w-7 h-7 border-none rounded-ss-md bg-transparent cursor-pointer text-ss-text-secondary text-body-lg transition-colors duration-ss hover:bg-ss-surface-tertiary hover:text-ss-text"
              onClick={handleClose}
              aria-label="Close extension panel"
              title="Close (Ctrl+Shift+E)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs (only show if multiple extensions) */}
        {extensions.length > 1 && (
          <ExtensionTabs
            extensions={extensions}
            activeExtensionId={activeExtensionId}
            onSelectExtension={onSelectExtension}
          />
        )}

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">{renderContent()}</div>
      </div>
    </div>
  );
}
