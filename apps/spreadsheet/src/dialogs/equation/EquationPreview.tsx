/**
 * Equation Preview Component
 *
 * Renders a live preview of LaTeX equations using KaTeX.
 * Shows error messages for invalid LaTeX input.
 *
 */

import katex from 'katex';
import { useEffect, useMemo, useRef } from 'react';

import { useDebouncedValue } from '../../hooks';

// =============================================================================
// Types
// =============================================================================

export interface EquationPreviewProps {
  /** LaTeX string to render */
  latex: string;
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Whether to display in block mode (default: true) */
  displayMode?: boolean;
  /** Called when preview encounters an error */
  onError?: (error: string | null) => void;
  /** Custom className for the container */
  className?: string;
  /** Font size override (default: 1.5em) */
  fontSize?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Live preview of LaTeX equations using KaTeX.
 *
 * Features:
 * - Debounced rendering for smooth typing experience
 * - Error display for invalid LaTeX
 * - Block mode for centered, larger equations
 * - Accessible via aria-live for screen readers
 */
export function EquationPreview({
  latex,
  debounceMs = 150,
  displayMode = true,
  onError,
  className = '',
  fontSize = '1.5em',
}: EquationPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedLatex = useDebouncedValue(latex, debounceMs);

  // Render equation with KaTeX
  const { html, error } = useMemo(() => {
    if (!debouncedLatex || debouncedLatex.trim().length === 0) {
      return { html: '', error: null };
    }

    try {
      const renderedHtml = katex.renderToString(debouncedLatex, {
        displayMode,
        throwOnError: true,
        errorColor: '#cc0000',
        trust: false, // Don't trust \url, \href, etc. for security
        strict: false, // Allow non-strict mode for more forgiving parsing
        macros: {
          // Common macros that users might expect
          '\\R': '\\mathbb{R}',
          '\\N': '\\mathbb{N}',
          '\\Z': '\\mathbb{Z}',
          '\\Q': '\\mathbb{Q}',
          '\\C': '\\mathbb{C}',
        },
      });
      return { html: renderedHtml, error: null };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid equation';
      return { html: '', error: errorMessage };
    }
  }, [debouncedLatex, displayMode]);

  // Notify parent of error state changes
  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  // Empty state
  if (!debouncedLatex || debouncedLatex.trim().length === 0) {
    return (
      <div
        className={`flex items-center justify-center min-h-[80px] p-4 bg-ss-surface-secondary rounded border border-dashed border-ss-border text-ss-text-tertiary text-body-sm ${className}`}
        role="status"
        aria-live="polite"
      >
        Enter an equation to see preview
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[80px] p-4 bg-ss-error/5 rounded border border-ss-error/30 ${className}`}
        role="alert"
        aria-live="assertive"
      >
        <div className="text-ss-error text-body-sm font-medium mb-1">Invalid Equation</div>
        <div className="text-ss-error/80 text-body-xs text-center max-w-full overflow-hidden text-ellipsis">
          {error}
        </div>
      </div>
    );
  }

  // Success state - render equation
  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center min-h-[80px] p-4 bg-ss-surface-secondary rounded border border-ss-border overflow-x-auto ${className}`}
      style={{ fontSize }}
      role="math"
      aria-live="polite"
      aria-label={`Equation preview: ${latex}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =============================================================================
// Small Preview Variant (for template gallery)
// =============================================================================

export interface EquationPreviewSmallProps {
  /** LaTeX string to render */
  latex: string;
  /** Custom className */
  className?: string;
}

/**
 * Small inline preview for template gallery items.
 * No debouncing since templates are static.
 */
export function EquationPreviewSmall({ latex, className = '' }: EquationPreviewSmallProps) {
  const html = useMemo(() => {
    if (!latex) return '';
    try {
      return katex.renderToString(latex, {
        displayMode: false, // Inline mode for smaller display
        throwOnError: false, // Don't throw, just show error inline
        errorColor: '#cc0000',
        trust: false,
        strict: false,
      });
    } catch {
      return '<span class="text-ss-error">Error</span>';
    }
  }, [latex]);

  return (
    <span
      className={`inline-flex items-center text-body-lg ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
