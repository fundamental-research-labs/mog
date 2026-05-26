/**
 * InkToolbar Component
 *
 * Floating toolbar that appears when ink mode is active.
 * Provides tool selection, color picker, width picker, and drawing actions.
 *
 * Wave 5: Ink Actions & UI System
 */

import { Sparkles, Trash2, Type, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { dispatch } from '../../../internal-api';

import type { InkTool } from '@mog-sdk/contracts/ink';
import { useInk } from '../../../hooks/objects/use-ink';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { EraserIcon, HighlighterIcon, PenIcon, SelectToolIcon } from '../primitives/ToolbarIcons';

import './ink-toolbar.css';

// =============================================================================
// Constants
// =============================================================================

/**
 * Available ink colors (8 colors matching Excel's quick color picker).
 * Excel-compatible ink color palette
 */
const INK_COLORS = [
  '#000000', // Black
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFFFFF', // White
];

/**
 * Available stroke widths in pixels.
 */
const STROKE_WIDTHS = [1, 2, 4, 8, 16];

// =============================================================================
// Component
// =============================================================================

/**
 * InkToolbar - floating toolbar for ink mode.
 *
 * Only renders when ink mode is active.
 * Uses dispatch() for all persistent actions.
 */
export function InkToolbar() {
  const deps = useActionDependencies();
  const { isActive, activeDrawingId, tool, color, width, hasSelection, isSelectionModeActive } =
    useInk();

  // Track text recognition availability (browser API)
  const [textRecognitionAvailable, setTextRecognitionAvailable] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);

  // Check if text recognition API is available on mount
  useEffect(() => {
    setTextRecognitionAvailable('Handwriting' in window);
  }, []);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Toggle ink tool.
   * Delegates to TOGGLE_INK_TOOL action for centralized logic.
   */
  const handleToolChange = useCallback(
    (newTool: InkTool) => {
      dispatch('TOGGLE_INK_TOOL', deps, { tool: newTool });
    },
    [deps],
  );

  const handleColorChange = useCallback(
    (newColor: string) => {
      dispatch('SET_INK_COLOR', deps, { color: newColor });
    },
    [deps],
  );

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      dispatch('SET_INK_WIDTH', deps, { width: newWidth });
    },
    [deps],
  );

  const handleToggleLasso = useCallback(() => {
    dispatch('TOGGLE_LASSO_SELECTION', deps);
  }, [deps]);

  const handleDeleteSelected = useCallback(() => {
    dispatch('DELETE_SELECTED_STROKES', deps);
  }, [deps]);

  const handleClearDrawing = useCallback(() => {
    dispatch('CLEAR_DRAWING', deps);
  }, [deps]);

  const handleClose = useCallback(() => {
    dispatch('DEACTIVATE_INK_MODE', deps);
  }, [deps]);

  const handleRecognizeShape = useCallback(async () => {
    if (isRecognizing) return;
    setIsRecognizing(true);
    try {
      await dispatch('RECOGNIZE_INK_AS_SHAPE', deps);
    } finally {
      setIsRecognizing(false);
    }
  }, [deps, isRecognizing]);

  const handleRecognizeText = useCallback(async () => {
    if (isRecognizing || !textRecognitionAvailable) return;
    setIsRecognizing(true);
    try {
      await dispatch('RECOGNIZE_INK_AS_TEXT', deps);
    } finally {
      setIsRecognizing(false);
    }
  }, [deps, isRecognizing, textRecognitionAvailable]);

  // Check if there are strokes to recognize (either selected or any in drawing)
  // This is a simplified check - in a full implementation we'd check the actual drawing
  const hasStrokes = activeDrawingId !== null;

  // ==========================================================================
  // Render
  // ==========================================================================

  // Only render when ink mode is active
  if (!isActive) {
    return null;
  }

  return (
    <div className="ink-toolbar" role="toolbar" aria-label="Ink Tools">
      {/* Tool Selection */}
      <div className="ink-toolbar__section ink-toolbar__tools">
        <button
          className={`ink-toolbar__tool-button ${tool === 'pen' ? 'ink-toolbar__tool-button--active' : ''}`}
          onClick={() => handleToolChange('pen')}
          title="Pen (P)"
          aria-label="Pen tool"
          aria-pressed={tool === 'pen'}
        >
          <PenIcon />
        </button>
        <button
          className={`ink-toolbar__tool-button ${tool === 'pencil' ? 'ink-toolbar__tool-button--active' : ''}`}
          onClick={() => handleToolChange('pencil')}
          title="Pencil"
          aria-label="Pencil tool"
          aria-pressed={tool === 'pencil'}
        >
          <PenIcon />
        </button>
        <button
          className={`ink-toolbar__tool-button ${tool === 'highlighter' ? 'ink-toolbar__tool-button--active' : ''}`}
          onClick={() => handleToolChange('highlighter')}
          title="Highlighter (H)"
          aria-label="Highlighter tool"
          aria-pressed={tool === 'highlighter'}
        >
          <HighlighterIcon />
        </button>
        <button
          className={`ink-toolbar__tool-button ${tool === 'eraser' ? 'ink-toolbar__tool-button--active' : ''}`}
          onClick={() => handleToolChange('eraser')}
          title="Eraser (E)"
          aria-label="Eraser tool"
          aria-pressed={tool === 'eraser'}
        >
          <EraserIcon />
        </button>
      </div>

      {/* Separator */}
      <div className="ink-toolbar__separator" />

      {/* Lasso Selection Toggle */}
      <div className="ink-toolbar__section">
        <button
          className={`ink-toolbar__tool-button ${isSelectionModeActive ? 'ink-toolbar__tool-button--active' : ''}`}
          onClick={handleToggleLasso}
          title="Lasso Selection (L)"
          aria-label="Lasso selection"
          aria-pressed={isSelectionModeActive}
        >
          <SelectToolIcon />
        </button>
      </div>

      {/* Separator */}
      <div className="ink-toolbar__separator" />

      {/* Color Picker */}
      <div className="ink-toolbar__section ink-toolbar__colors">
        {INK_COLORS.map((c) => (
          <button
            key={c}
            className={`ink-toolbar__color-button ${color === c ? 'ink-toolbar__color-button--active' : ''}`}
            style={{
              backgroundColor: c,
              border: c === '#FFFFFF' ? '1px solid var(--color-ss-border)' : 'none',
            }}
            onClick={() => handleColorChange(c)}
            title={c}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
          />
        ))}
      </div>

      {/* Separator */}
      <div className="ink-toolbar__separator" />

      {/* Width Picker */}
      <div className="ink-toolbar__section ink-toolbar__widths">
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            className={`ink-toolbar__width-button ${width === w ? 'ink-toolbar__width-button--active' : ''}`}
            onClick={() => handleWidthChange(w)}
            title={`${w}px`}
            aria-label={`Stroke width ${w}px`}
            aria-pressed={width === w}
          >
            <span
              className="ink-toolbar__width-preview"
              style={{
                width: Math.min(w * 2, 24),
                height: Math.min(w, 12),
                backgroundColor: 'currentColor',
              }}
            />
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="ink-toolbar__separator" />

      {/* Recognition Actions */}
      <div className="ink-toolbar__section ink-toolbar__recognition">
        <button
          className={`ink-toolbar__action-button ${isRecognizing ? 'ink-toolbar__action-button--loading' : ''}`}
          onClick={handleRecognizeShape}
          disabled={!hasStrokes || isRecognizing}
          title="Recognize as Shape (Ctrl+Shift+S)"
          aria-label="Recognize ink as shape"
        >
          <Sparkles size={16} />
        </button>
        <button
          className={`ink-toolbar__action-button ${isRecognizing ? 'ink-toolbar__action-button--loading' : ''}`}
          onClick={handleRecognizeText}
          disabled={!hasStrokes || isRecognizing || !textRecognitionAvailable}
          title={
            textRecognitionAvailable
              ? 'Recognize as Text (Ctrl+Shift+T)'
              : 'Text recognition not available in this browser'
          }
          aria-label="Recognize ink as text"
        >
          <Type size={16} />
        </button>
      </div>

      {/* Separator */}
      <div className="ink-toolbar__separator" />

      {/* Actions */}
      <div className="ink-toolbar__section ink-toolbar__actions">
        {/* Delete Selected - only visible when there's a selection */}
        {hasSelection && (
          <button
            className="ink-toolbar__action-button ink-toolbar__action-button--danger"
            onClick={handleDeleteSelected}
            title="Delete Selected (Delete)"
            aria-label="Delete selected strokes"
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          className="ink-toolbar__action-button"
          onClick={handleClearDrawing}
          title="Clear All"
          aria-label="Clear all strokes"
        >
          <EraserIcon />
        </button>
        <button
          className="ink-toolbar__action-button"
          onClick={handleClose}
          title="Exit Ink Mode (Escape)"
          aria-label="Exit ink mode"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
