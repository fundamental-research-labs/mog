/**
 * @mog-sdk/embed/publish — React component for read-only published sheets.
 *
 * This component wraps createPublishView and exposes a strictly read-only
 * surface: no edit callbacks, no save callbacks, no dirty state, no mutation
 * methods on the imperative handle.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';

import { createPublishView } from './mount';
import type {
  MogPublishConfig,
  PublishViewHandle,
  PublishMetadata,
  PublishCachePolicy,
  PublishSecurityPolicy,
  PublishChromeOptions,
  MogPublishEffectiveState,
  PublishViewStatus,
} from './types';
import type { MogEmbedThemeOptions } from '../config';

// ---------------------------------------------------------------------------
// Props — no mutation, save, export, or collaboration callbacks
// ---------------------------------------------------------------------------

export interface MogPublishedSheetProps {
  /** Reference to the publish artifact (snapshot ID or signed URL). */
  snapshotRef: string;
  /** Public-safe metadata for display. */
  metadata: PublishMetadata;
  /** Theme options. */
  theme?: MogEmbedThemeOptions;
  /** Cache policy. */
  cachePolicy?: PublishCachePolicy;
  /** Require deterministic rendering. */
  deterministicRender?: boolean;
  /** Security/redaction policy. */
  securityPolicy?: PublishSecurityPolicy;
  /** Initial sheet (index or name). */
  sheet?: number | string;
  /** Locale override. */
  locale?: string;
  /** Chrome options. */
  chrome?: PublishChromeOptions;

  // --- Layout ---
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;

  // --- Lifecycle callbacks (read-only events only) ---
  onReady?: () => void;
  onError?: (error: Error) => void;
  onSheetChange?: (sheet: { index: number; name: string }) => void;
}

// ---------------------------------------------------------------------------
// Imperative ref — same as PublishViewHandle, no mutation methods
// ---------------------------------------------------------------------------

export type MogPublishedSheetRef = PublishViewHandle;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MogPublishedSheet = forwardRef<MogPublishedSheetRef, MogPublishedSheetProps>(
  function MogPublishedSheet(props, ref) {
    const {
      snapshotRef,
      metadata,
      theme,
      cachePolicy,
      deterministicRender,
      securityPolicy,
      sheet,
      locale,
      chrome,
      width = '100%',
      height = '100%',
      className,
      style,
      onReady,
      onError,
      onSheetChange: _onSheetChange,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<PublishViewHandle | null>(null);

    const onReadyRef = useRef(onReady);
    const onErrorRef = useRef(onError);
    onReadyRef.current = onReady;
    onErrorRef.current = onError;

    useImperativeHandle(ref, () => ({
      get ready() {
        return handleRef.current?.ready ?? Promise.resolve();
      },
      getStatus(): PublishViewStatus {
        return handleRef.current?.getStatus() ?? 'initializing';
      },
      getEffectiveState(): MogPublishEffectiveState {
        return (
          handleRef.current?.getEffectiveState() ?? {
            mode: 'readonly' as const,
            savePolicy: 'none' as const,
            collaboration: 'none' as const,
            dirty: false as const,
            saveState: 'idle' as const,
            canExport: false as const,
            canMutate: false as const,
            status: 'initializing' as const,
            chrome: { sheetTabs: true, headers: true, gridlines: true },
            deterministicRender: false,
          }
        );
      },
      getMetadata(): PublishMetadata {
        return handleRef.current?.getMetadata() ?? metadata;
      },
      setSheet(indexOrName: number | string) {
        return handleRef.current?.setSheet(indexOrName) ?? Promise.resolve();
      },
      getSheetNames() {
        return handleRef.current?.getSheetNames() ?? Promise.resolve([]);
      },
      resize(w: number, h: number) {
        handleRef.current?.resize(w, h);
      },
      dispose() {
        handleRef.current?.dispose();
        handleRef.current = null;
      },
    }));

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const config: MogPublishConfig = {
        snapshotRef,
        metadata,
        theme,
        cachePolicy,
        deterministicRender,
        securityPolicy,
        sheet,
        locale,
        chrome,
      };

      try {
        const handle = createPublishView(el, config);
        handleRef.current = handle;

        handle.ready
          .then(() => onReadyRef.current?.())
          .catch((err: Error) => onErrorRef.current?.(err));
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }

      return () => {
        handleRef.current?.dispose();
        handleRef.current = null;
      };
    }, [
      snapshotRef,
      metadata,
      theme,
      cachePolicy,
      deterministicRender,
      securityPolicy,
      sheet,
      locale,
      chrome,
    ]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          position: 'relative',
          width,
          height,
          overflow: 'hidden',
          ...style,
        }}
      />
    );
  },
);

MogPublishedSheet.displayName = 'MogPublishedSheet';
