/**
 * DrawRibbon Component Tests
 *
 * Tests for the Draw ribbon tab component.
 * Verifies button rendering, action dispatching, and visual state.
 *
 * ARCHITECTURE: Tests verify that dispatch() is called with correct action types
 * and payloads, following the render isolation pattern.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 1, 2, 17)
 */

import { jest } from '@jest/globals';

import type { InkTool } from '@mog-sdk/contracts/ink';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

// =============================================================================
// Mocks - MUST BE DEFINED BEFORE IMPORTS
// =============================================================================

// Mock ink state - mutable for per-test configuration
let mockInkState = {
  isActive: false,
  tool: 'pen' as InkTool,
  isSelectionModeActive: false,
};

// Mock useInk hook
jest.unstable_mockModule('../../../hooks/objects/use-ink', () => ({
  useInk: () => mockInkState,
}));

// Mock dispatch
const mockDispatch = jest.fn();
jest.unstable_mockModule('../../../hooks/toolbar/use-action-dependencies', () => ({
  useDispatch: () => mockDispatch,
}));

// Mock ToolbarGroup to simplify testing (just renders children)
jest.unstable_mockModule('../primitives/ToolbarGroup', () => ({
  ToolbarGroup: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div data-testid={`toolbar-group-${label.toLowerCase()}`}>{children}</div>
  ),
}));

// Mock RibbonButton to be testable
jest.unstable_mockModule('../primitives/RibbonButton', () => ({
  RibbonButton: ({
    label,
    onClick,
    isOpen,
    disabled,
    title,
  }: {
    label: string;
    onClick: () => void;
    isOpen?: boolean;
    disabled?: boolean;
    title?: string;
    icon?: React.ReactNode;
    layout?: string;
    height?: string;
  }) => (
    <button
      aria-label={label}
      onClick={onClick}
      data-active={isOpen}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  ),
}));

// Mock icons (they're just SVGs)
jest.unstable_mockModule('../primitives/ToolbarIcons', () => ({
  DrawIcon: () => <span data-testid="draw-icon" />,
  EraserIcon: () => <span data-testid="eraser-icon" />,
  PenIcon: () => <span data-testid="pen-icon" />,
  HighlighterIcon: () => <span data-testid="highlighter-icon" />,
  InkToShapeIcon: () => <span data-testid="ink-to-shape-icon" />,
  InkToMathIcon: () => <span data-testid="ink-to-math-icon" />,
  SelectObjectsIcon: () => <span data-testid="select-objects-icon" />,
  SelectToolIcon: () => <span data-testid="select-tool-icon" />,
}));

// Now import component after mocks
const { DrawRibbon } = await import('../tabs/DrawRibbon');

// =============================================================================
// Tests
// =============================================================================

describe('DrawRibbon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default state
    mockInkState = {
      isActive: false,
      tool: 'pen',
      isSelectionModeActive: false,
    };
  });

  // ===========================================================================
  // Test 1: Renders all expected buttons
  // ===========================================================================

  describe('rendering', () => {
    it('renders Tools group with all buttons', () => {
      render(<DrawRibbon />);

      expect(screen.getByLabelText('Select Objects')).toBeInTheDocument();
      expect(screen.getByLabelText('Draw')).toBeInTheDocument();
      expect(screen.getByLabelText('Eraser')).toBeInTheDocument();
      expect(screen.getByLabelText('Lasso Select')).toBeInTheDocument();
    });

    it('renders Pens group with all buttons', () => {
      render(<DrawRibbon />);

      expect(screen.getByLabelText('Pen')).toBeInTheDocument();
      expect(screen.getByLabelText('Highlight')).toBeInTheDocument();
    });

    it('renders Convert group with all buttons', () => {
      render(<DrawRibbon />);

      expect(screen.getByLabelText('Ink to Shape')).toBeInTheDocument();
      expect(screen.getByLabelText('Ink to Math')).toBeInTheDocument();
    });

    it('renders all three toolbar groups', () => {
      render(<DrawRibbon />);

      expect(screen.getByTestId('toolbar-group-tools')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-group-pens')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-group-convert')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Test 2: Tools Group - Dispatch Actions
  // ===========================================================================

  describe('Tools Group - actions', () => {
    it('dispatches DEACTIVATE_INK_MODE when Select Objects clicked', () => {
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Select Objects'));

      expect(mockDispatch).toHaveBeenCalledWith('DEACTIVATE_INK_MODE');
    });

    it('dispatches TOGGLE_INK_TOOL with pen when Draw clicked', () => {
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Draw'));

      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_INK_TOOL', { tool: 'pen' });
    });

    it('dispatches TOGGLE_INK_TOOL with eraser when Eraser clicked', () => {
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Eraser'));

      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_INK_TOOL', { tool: 'eraser' });
    });

    it('activates ink mode AND toggles lasso when ink not active', () => {
      mockInkState.isActive = false;
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Lasso Select'));

      // Should call both - activate first, then toggle
      expect(mockDispatch).toHaveBeenCalledWith('ACTIVATE_INK_MODE');
      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_LASSO_SELECTION');
    });

    it('only toggles lasso when ink already active', () => {
      mockInkState.isActive = true;
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Lasso Select'));

      expect(mockDispatch).not.toHaveBeenCalledWith('ACTIVATE_INK_MODE');
      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_LASSO_SELECTION');
    });
  });

  // ===========================================================================
  // Test 3: Pens Group - Dispatch Actions
  // ===========================================================================

  describe('Pens Group - actions', () => {
    it('dispatches TOGGLE_INK_TOOL with pen when Pen clicked', () => {
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Pen'));

      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_INK_TOOL', { tool: 'pen' });
    });

    it('dispatches TOGGLE_INK_TOOL with highlighter when Highlight clicked', () => {
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Highlight'));

      expect(mockDispatch).toHaveBeenCalledWith('TOGGLE_INK_TOOL', { tool: 'highlighter' });
    });
  });

  // ===========================================================================
  // Test 4: Convert Group - Dispatch Actions
  // ===========================================================================

  describe('Convert Group - actions', () => {
    it('dispatches RECOGNIZE_INK_AS_SHAPE when Ink to Shape clicked', () => {
      mockInkState.isActive = true; // Must be active to click
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Ink to Shape'));

      expect(mockDispatch).toHaveBeenCalledWith('RECOGNIZE_INK_AS_SHAPE');
    });

    it('dispatches RECOGNIZE_INK_AS_TEXT when Ink to Math clicked', () => {
      mockInkState.isActive = true; // Must be active to click
      render(<DrawRibbon />);

      fireEvent.click(screen.getByLabelText('Ink to Math'));

      expect(mockDispatch).toHaveBeenCalledWith('RECOGNIZE_INK_AS_TEXT');
    });
  });

  // ===========================================================================
  // Test 5: Convert Group - Disabled State
  // ===========================================================================

  describe('Convert Group - disabled state', () => {
    it('disables Ink to Shape when ink mode not active', () => {
      mockInkState.isActive = false;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Shape');
      expect(button).toBeDisabled();
    });

    it('enables Ink to Shape when ink mode active', () => {
      mockInkState.isActive = true;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Shape');
      expect(button).not.toBeDisabled();
    });

    it('disables Ink to Math when ink mode not active', () => {
      mockInkState.isActive = false;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Math');
      expect(button).toBeDisabled();
    });

    it('enables Ink to Math when ink mode active', () => {
      mockInkState.isActive = true;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Math');
      expect(button).not.toBeDisabled();
    });
  });

  // ===========================================================================
  // Test 6: Visual State - Active Indicators
  // ===========================================================================

  describe('visual state - active indicators', () => {
    it('marks Select Objects as active when ink mode NOT active', () => {
      mockInkState.isActive = false;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Select Objects');
      expect(button).toHaveAttribute('data-active', 'true');
    });

    it('marks Select Objects as NOT active when ink mode active', () => {
      mockInkState.isActive = true;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Select Objects');
      expect(button).toHaveAttribute('data-active', 'false');
    });

    it('marks Draw as active when ink active and tool is pen', () => {
      mockInkState.isActive = true;
      mockInkState.tool = 'pen';
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Draw');
      expect(button).toHaveAttribute('data-active', 'true');
    });

    it('marks Eraser as active when ink active and tool is eraser', () => {
      mockInkState.isActive = true;
      mockInkState.tool = 'eraser';
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Eraser');
      expect(button).toHaveAttribute('data-active', 'true');
    });

    it('marks Lasso Select as active when selection mode active', () => {
      mockInkState.isActive = true;
      mockInkState.isSelectionModeActive = true;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Lasso Select');
      expect(button).toHaveAttribute('data-active', 'true');
    });

    it('marks Pen as active when ink active and tool is pen', () => {
      mockInkState.isActive = true;
      mockInkState.tool = 'pen';
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Pen');
      expect(button).toHaveAttribute('data-active', 'true');
    });

    it('marks Highlight as active when ink active and tool is highlighter', () => {
      mockInkState.isActive = true;
      mockInkState.tool = 'highlighter';
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Highlight');
      expect(button).toHaveAttribute('data-active', 'true');
    });
  });

  // ===========================================================================
  // Test 7: Tooltips
  // ===========================================================================

  describe('tooltips', () => {
    it('shows keyboard shortcut hint for Draw', () => {
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Draw');
      expect(button).toHaveAttribute('title', 'Draw with Pen (P)');
    });

    it('shows keyboard shortcut hint for Eraser', () => {
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Eraser');
      expect(button).toHaveAttribute('title', 'Eraser (E)');
    });

    it('shows keyboard shortcut hint for Lasso Select', () => {
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Lasso Select');
      expect(button).toHaveAttribute('title', 'Lasso Select (L)');
    });

    it('shows context-aware tooltip for Ink to Shape when active', () => {
      mockInkState.isActive = true;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Shape');
      expect(button).toHaveAttribute('title', 'Convert ink to shapes');
    });

    it('shows context-aware tooltip for Ink to Shape when NOT active', () => {
      mockInkState.isActive = false;
      render(<DrawRibbon />);

      const button = screen.getByLabelText('Ink to Shape');
      expect(button).toHaveAttribute('title', 'Ink to Shape (enter drawing mode first)');
    });
  });
});
