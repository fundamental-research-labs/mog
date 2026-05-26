/**
 * DrawRibbon
 *
 * Draw tab content matching Excel 365 group order:
 * 1. Tools - Select Objects, Draw, Eraser, Lasso Select
 * 2. Pens - Pen, Highlighter
 * 3. Convert - Ink to Shape, Ink to Math
 *
 * Wires up to the Ink Engine action system for drawing functionality.
 *
 * Ribbon Polish
 * Wave 5 - Ink Actions & UI System
 *
 * Uses RibbonButton for consistent button styling (single source of truth).
 */

import { useCallback } from 'react';

import type { InkTool } from '@mog-sdk/contracts/ink';
import {
  DRAW_CONVERT_COLLAPSE_CONFIG,
  DRAW_PENS_COLLAPSE_CONFIG,
  DRAW_TOOLS_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { useInk } from '../../../hooks/objects/use-ink';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  DrawIcon,
  EraserIcon,
  HighlighterIcon,
  InkToMathIcon,
  InkToShapeIcon,
  PenIcon,
  SelectObjectsIcon,
  SelectToolIcon,
} from '../primitives/ToolbarIcons';

export function DrawRibbon() {
  const dispatch = useDispatch();
  const { isActive, tool, isSelectionModeActive } = useInk();

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Toggle ink mode with specified tool.
   * Delegates to TOGGLE_INK_TOOL action for centralized logic.
   */
  const handleToolSelect = useCallback(
    (selectedTool: InkTool) => {
      dispatch('TOGGLE_INK_TOOL', { tool: selectedTool });
    },
    [dispatch],
  );

  /**
   * Toggle lasso selection mode.
   * Activates ink mode if not already active.
   */
  const handleLassoToggle = useCallback(() => {
    if (!isActive) {
      dispatch('ACTIVATE_INK_MODE');
    }
    dispatch('TOGGLE_LASSO_SELECTION');
  }, [dispatch, isActive]);

  /**
   * Deactivate ink mode (back to normal editing).
   */
  const handleDeactivate = useCallback(() => {
    dispatch('DEACTIVATE_INK_MODE');
  }, [dispatch]);

  /**
   * Recognize selected strokes as shapes.
   */
  const handleInkToShape = useCallback(() => {
    dispatch('RECOGNIZE_INK_AS_SHAPE');
  }, [dispatch]);

  /**
   * Recognize selected strokes as text (math formulas).
   */
  const handleInkToMath = useCallback(() => {
    dispatch('RECOGNIZE_INK_AS_TEXT');
  }, [dispatch]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <>
      {/* 1. Tools Group - Excel order: Select Objects, Draw, Eraser, Lasso Select */}
      <ToolbarGroup
        label="Tools"
        collapseConfig={DRAW_TOOLS_COLLAPSE_CONFIG}
        dropdownIcon={<SelectObjectsIcon />}
      >
        {/* Select Objects - deactivates ink mode back to normal editing */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<SelectObjectsIcon />}
          label="Select Objects"
          onClick={handleDeactivate}
          isOpen={!isActive}
          title="Select Objects - Exit drawing mode (Escape)"
          aria-label="Select Objects"
        />
        {/* Draw button - activates pen tool */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<DrawIcon />}
          label="Draw"
          onClick={() => handleToolSelect('pen')}
          isOpen={isActive && tool === 'pen'}
          title="Draw with Pen (P)"
          aria-label="Draw"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<EraserIcon />}
          label="Eraser"
          onClick={() => handleToolSelect('eraser')}
          isOpen={isActive && tool === 'eraser'}
          title="Eraser (E)"
          aria-label="Eraser"
        />
        {/* Lasso Select for selecting strokes */}
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<SelectToolIcon />}
          label="Lasso Select"
          onClick={handleLassoToggle}
          isOpen={isActive && isSelectionModeActive}
          title="Lasso Select (L)"
          aria-label="Lasso Select"
        />
      </ToolbarGroup>

      {/* 2. Pens Group */}
      <ToolbarGroup
        label="Pens"
        collapseConfig={DRAW_PENS_COLLAPSE_CONFIG}
        dropdownIcon={<PenIcon />}
      >
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<PenIcon />}
          label="Pen"
          onClick={() => handleToolSelect('pen')}
          isOpen={isActive && tool === 'pen'}
          title="Pen (P)"
          aria-label="Pen"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<HighlighterIcon />}
          label="Highlight"
          onClick={() => handleToolSelect('highlighter')}
          isOpen={isActive && tool === 'highlighter'}
          title="Highlighter (H)"
          aria-label="Highlighter"
        />
      </ToolbarGroup>

      {/* 3. Convert Group - Ink recognition tools */}
      <ToolbarGroup
        label="Convert"
        isLast
        collapseConfig={DRAW_CONVERT_COLLAPSE_CONFIG}
        dropdownIcon={<InkToShapeIcon />}
      >
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<InkToShapeIcon />}
          label="Ink to Shape"
          onClick={handleInkToShape}
          disabled={!isActive}
          title={isActive ? 'Convert ink to shapes' : 'Ink to Shape (enter drawing mode first)'}
          aria-label="Ink to Shape"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<InkToMathIcon />}
          label="Ink to Math"
          onClick={handleInkToMath}
          disabled={!isActive}
          title={
            isActive ? 'Convert ink to math formula' : 'Ink to Math (enter drawing mode first)'
          }
          aria-label="Ink to Math"
        />
      </ToolbarGroup>
    </>
  );
}
