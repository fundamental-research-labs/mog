/**
 * EquationEditorDialog Component Tests
 *
 * Tests for the Equation Editor dialog component.
 * Verifies dialog rendering, LaTeX input handling, template selection,
 * and action dispatching via the Unified Action System.
 *
 * ARCHITECTURE: Tests verify that dispatch() is called with correct action types
 * and payloads, following the render isolation pattern.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 1, 2, 17)
 */

import { jest } from '@jest/globals';

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// =============================================================================
// Mocks - MUST BE DEFINED BEFORE IMPORTS
// =============================================================================

// Mock KaTeX to avoid rendering issues in tests
const mockRenderToString = jest.fn((latex: string) => {
  if (latex.includes('invalid')) {
    throw new Error('KaTeX parse error: Invalid LaTeX');
  }
  return `<span class="katex">${latex}</span>`;
});

jest.unstable_mockModule('katex', () => ({
  default: {
    renderToString: mockRenderToString,
  },
  renderToString: mockRenderToString,
}));

// Mock UIStore state and actions - declare before mock
let mockDialogState = {
  isOpen: true,
  latex: '',
  selectedCategory: 'basic' as const,
  editingEquationId: null as string | null,
  targetRow: 0,
  targetCol: 0,
  isPreviewLoading: false,
  previewError: null as string | null,
  recentTemplates: [] as string[],
};

const mockSetLatex = jest.fn();
const mockSetCategory = jest.fn();
const mockApplyTemplate = jest.fn();
const mockAddRecentTemplate = jest.fn();
const mockSetPreviewError = jest.fn();

const mockDispatch = jest.fn();
const mockDeps = { ctx: {}, getActiveSheetId: () => 'sheet-1' };

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
    variant?: string;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick} title={title}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open === false ? null : (
      <div role="dialog" aria-modal="true">
        {children}
      </div>
    ),
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <header>
      <h2>{children}</h2>
      <button type="button" aria-label="Close" onClick={onClose}>
        Close
      </button>
    </header>
  ),
  FormField: ({
    children,
    label,
    htmlFor,
  }: {
    children: React.ReactNode;
    label: string;
    htmlFor?: string;
    helpText?: string;
  }) => (
    <div>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  ),
  Tabs: ({
    tabs,
    activeTab,
    onTabChange,
  }: {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onTabChange: (tab: string) => void;
    className?: string;
  }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  Textarea: React.forwardRef<
    HTMLTextAreaElement,
    {
      id?: string;
      value: string;
      onChange: (value: string) => void;
      placeholder?: string;
      rows?: number;
      className?: string;
      error?: boolean;
    }
  >(({ error: _error, onChange, ...props }, ref) => (
    <textarea ref={ref} {...props} onChange={(event) => onChange(event.target.value)} />
  )),
}));

jest.unstable_mockModule('../../../actions/dispatcher', () => ({
  dispatch: (...args: unknown[]) => mockDispatch(...args),
}));

jest.unstable_mockModule('../../../internal-api', () => ({
  dispatch: (...args: unknown[]) => mockDispatch(...args),
  useActionDependencies: () => mockDeps,
  useUIStore: (selector: (state: unknown) => unknown) => {
    const mockState = {
      equationDialog: mockDialogState,
      setEquationLatex: mockSetLatex,
      setEquationCategory: mockSetCategory,
      applyEquationTemplate: mockApplyTemplate,
      addRecentEquationTemplate: mockAddRecentTemplate,
      setEquationPreviewError: mockSetPreviewError,
    };
    return selector(mockState);
  },
}));

jest.unstable_mockModule('../../../hooks', () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

// Now import components after mocks are set up
// TODO: Restore when test utils are migrated
// import { renderWithCoordinator } from '@mog/testing';
import { render } from '@testing-library/react';
const { EquationEditorDialog } = await import('../EquationEditorDialog');
const renderWithCoordinator = (component: React.ReactElement) => {
  // Stub: Just use basic render until proper test utils are migrated
  return render(component);
};

// =============================================================================
// Test Setup
// =============================================================================

describe('EquationEditorDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset dialog state to default
    mockDialogState = {
      isOpen: true,
      latex: '',
      selectedCategory: 'basic',
      editingEquationId: null,
      targetRow: 0,
      targetCol: 0,
      isPreviewLoading: false,
      previewError: null,
      recentTemplates: [],
    };
  });

  // ===========================================================================
  // Test 1: Dialog renders when isOpen is true
  // ===========================================================================

  describe('rendering when open', () => {
    it('renders dialog when isOpen is true', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Insert Equation' })).toBeInTheDocument();
    });

    it('displays target cell reference', () => {
      mockDialogState.targetRow = 4;
      mockDialogState.targetCol = 2; // Column C

      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByText('C5')).toBeInTheDocument();
      expect(screen.getByText(/Target cell:/)).toBeInTheDocument();
    });

    it('renders Insert button for new equations', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByRole('button', { name: 'Insert' })).toBeInTheDocument();
    });

    it('renders Update button when editing existing equation', () => {
      mockDialogState.editingEquationId = 'eq-123';

      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByRole('heading', { name: 'Edit Equation' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders LaTeX input textarea', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByLabelText('LaTeX Equation')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Test 2: Dialog does not render when isOpen is false
  // ===========================================================================

  describe('rendering when closed', () => {
    it('does not render dialog when isOpen is false', () => {
      mockDialogState.isOpen = false;

      const { container } = renderWithCoordinator(<EquationEditorDialog />);

      expect(container.firstChild).toBeNull();
    });
  });

  // ===========================================================================
  // Test 3: LaTeX input updates state correctly
  // ===========================================================================

  describe('LaTeX input handling', () => {
    it('calls setLatex when input changes', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      const textarea = screen.getByLabelText('LaTeX Equation');
      fireEvent.change(textarea, { target: { value: '\\frac{1}{2}' } });

      expect(mockSetLatex).toHaveBeenCalledWith('\\frac{1}{2}');
    });

    it('displays current latex value from state', () => {
      mockDialogState.latex = '\\sqrt{x}';

      renderWithCoordinator(<EquationEditorDialog />);

      const textarea = screen.getByLabelText('LaTeX Equation') as HTMLTextAreaElement;
      expect(textarea.value).toBe('\\sqrt{x}');
    });

    it('shows preview for valid LaTeX', () => {
      mockDialogState.latex = '\\frac{a}{b}';

      renderWithCoordinator(<EquationEditorDialog />);

      // Preview should be rendered (mocked KaTeX returns span with latex content)
      expect(screen.getByRole('math')).toBeInTheDocument();
    });

    it('enables Insert button when latex is not empty and no error', () => {
      mockDialogState.latex = '\\frac{1}{2}';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      expect(insertButton).not.toBeDisabled();
    });

    it('disables Insert button when latex is empty', () => {
      mockDialogState.latex = '';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      expect(insertButton).toBeDisabled();
    });

    it('disables Insert button when there is a preview error', () => {
      mockDialogState.latex = '\\frac{1}{2}';
      mockDialogState.previewError = 'Parse error';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      expect(insertButton).toBeDisabled();
    });
  });

  // ===========================================================================
  // Test 4: Template selection updates the LaTeX input
  // ===========================================================================

  describe('template selection', () => {
    it('renders Templates tab', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByRole('tab', { name: 'Templates' })).toBeInTheDocument();
    });

    it('switches to Templates tab when clicked', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Wait for template gallery to appear - look for category tabs inside gallery
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });
    });

    it('calls applyTemplate when a template is selected', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      // Switch to Templates tab
      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Wait for template gallery to render
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });

      // Click a template - use aria-label selector which includes "Insert Fraction"
      const fractionTemplate = screen.getByLabelText(/Insert Fraction equation/);
      await user.click(fractionTemplate);

      // Verify applyTemplate was called with the correct template
      expect(mockApplyTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'basic-fraction',
          name: 'Fraction',
          latex: '\\frac{a}{b}',
          category: 'basic',
        }),
      );
    });

    it('calls addRecentTemplate when a template is selected', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      // Switch to Templates tab
      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Wait for template gallery to render
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });

      // Click a template - use aria-label selector
      const sqrtTemplate = screen.getByLabelText(/Insert Square Root equation/);
      await user.click(sqrtTemplate);

      expect(mockAddRecentTemplate).toHaveBeenCalledWith('basic-sqrt');
    });
  });

  // ===========================================================================
  // Test 5: Insert button dispatches UPDATE_EQUATION action
  // ===========================================================================

  describe('insert/save action', () => {
    it('dispatches UPDATE_EQUATION with latex when Insert is clicked', () => {
      mockDialogState.latex = '\\frac{1}{2}';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      fireEvent.click(insertButton);

      expect(mockDispatch).toHaveBeenCalledWith('UPDATE_EQUATION', mockDeps, {
        objectId: null,
        latex: '\\frac{1}{2}',
      });
    });

    it('dispatches UPDATE_EQUATION with equationId when updating existing equation', () => {
      mockDialogState.latex = '\\sqrt{x}';
      mockDialogState.editingEquationId = 'eq-456';

      renderWithCoordinator(<EquationEditorDialog />);

      const updateButton = screen.getByRole('button', { name: 'Update' });
      fireEvent.click(updateButton);

      expect(mockDispatch).toHaveBeenCalledWith('UPDATE_EQUATION', mockDeps, {
        objectId: 'eq-456',
        latex: '\\sqrt{x}',
      });
    });

    it('does not dispatch when latex is empty', () => {
      mockDialogState.latex = ' ';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      fireEvent.click(insertButton);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch when there is a preview error', () => {
      mockDialogState.latex = '\\invalid';
      mockDialogState.previewError = 'Parse error';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      fireEvent.click(insertButton);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('trims whitespace from latex before dispatching', () => {
      mockDialogState.latex = ' \\frac{a}{b} ';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      fireEvent.click(insertButton);

      expect(mockDispatch).toHaveBeenCalledWith('UPDATE_EQUATION', mockDeps, {
        objectId: null,
        latex: '\\frac{a}{b}',
      });
    });
  });

  // ===========================================================================
  // Test 6: Cancel button dispatches CLOSE_EQUATION_DIALOG
  // ===========================================================================

  describe('cancel action', () => {
    it('dispatches CLOSE_EQUATION_DIALOG when Cancel is clicked', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(mockDispatch).toHaveBeenCalledWith('CLOSE_EQUATION_DIALOG', mockDeps);
    });

    it('dispatches CLOSE_EQUATION_DIALOG when header close button is clicked', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      // Find and click the close button (X) in the header
      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockDispatch).toHaveBeenCalledWith('CLOSE_EQUATION_DIALOG', mockDeps);
    });
  });

  // ===========================================================================
  // Test 7: Error state displays error message
  // ===========================================================================

  describe('error state', () => {
    it('displays error state in preview when LaTeX is invalid', async () => {
      // Use invalid latex that triggers KaTeX error
      mockDialogState.latex = 'invalid';

      renderWithCoordinator(<EquationEditorDialog />);

      // Wait for the error to be displayed
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText('Invalid Equation')).toBeInTheDocument();
    });

    it('calls setPreviewError when preview encounters an error', async () => {
      mockDialogState.latex = 'invalid';

      renderWithCoordinator(<EquationEditorDialog />);

      // Wait for error callback
      await waitFor(() => {
        expect(mockSetPreviewError).toHaveBeenCalled();
      });
    });

    it('shows tooltip on disabled Insert button explaining the error', () => {
      mockDialogState.latex = '\\frac{1}{2}';
      mockDialogState.previewError = 'Parse error';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      expect(insertButton).toHaveAttribute('title', 'Fix equation errors first');
    });

    it('shows tooltip explaining empty input', () => {
      mockDialogState.latex = '';

      renderWithCoordinator(<EquationEditorDialog />);

      const insertButton = screen.getByRole('button', { name: 'Insert' });
      expect(insertButton).toHaveAttribute('title', 'Enter an equation');
    });
  });

  // ===========================================================================
  // Test 8: Tab switching between Editor and Templates tabs works
  // ===========================================================================

  describe('tab switching', () => {
    it('renders Editor tab by default', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      const editorTab = screen.getByRole('tab', { name: 'Editor' });
      expect(editorTab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to Templates tab when clicked', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      await waitFor(() => {
        expect(templatesTab).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('switches back to Editor tab when clicked', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      // Switch to Templates
      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Switch back to Editor
      const editorTab = screen.getByRole('tab', { name: 'Editor' });
      await user.click(editorTab);

      await waitFor(() => {
        expect(editorTab).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('shows LaTeX input in Editor tab', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByLabelText('LaTeX Equation')).toBeInTheDocument();
    });

    it('exposes the LaTeX input through an aria-label', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByLabelText('LaTeX Equation')).toHaveAttribute(
        'aria-label',
        'LaTeX Equation',
      );
    });

    it('shows template gallery in Templates tab', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      await waitFor(() => {
        // Should show category tabs
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });
    });

    it('switches to Editor tab after selecting a template', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      // Switch to Templates
      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Wait for template gallery to render
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });

      // Select a template - use aria-label selector
      const fractionTemplate = screen.getByLabelText(/Insert Fraction equation/);
      await user.click(fractionTemplate);

      // Should switch back to Editor tab
      await waitFor(() => {
        const editorTab = screen.getByRole('tab', { name: 'Editor' });
        expect(editorTab).toHaveAttribute('aria-selected', 'true');
      });
    });
  });

  // ===========================================================================
  // Additional Tests: Keyboard shortcuts
  // ===========================================================================

  describe('keyboard shortcuts', () => {
    it('submits on Ctrl+Enter when valid', () => {
      mockDialogState.latex = '\\frac{1}{2}';

      renderWithCoordinator(<EquationEditorDialog />);

      const textarea = screen.getByLabelText('LaTeX Equation');
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      expect(mockDispatch).toHaveBeenCalledWith('UPDATE_EQUATION', mockDeps, {
        objectId: null,
        latex: '\\frac{1}{2}',
      });
    });

    it('submits on Cmd+Enter (Mac) when valid', () => {
      mockDialogState.latex = '\\sqrt{x}';

      renderWithCoordinator(<EquationEditorDialog />);

      const textarea = screen.getByLabelText('LaTeX Equation');
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(mockDispatch).toHaveBeenCalledWith('UPDATE_EQUATION', mockDeps, {
        objectId: null,
        latex: '\\sqrt{x}',
      });
    });

    it('does not submit on Enter without modifier', () => {
      mockDialogState.latex = '\\pi';

      renderWithCoordinator(<EquationEditorDialog />);

      const textarea = screen.getByLabelText('LaTeX Equation');
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Additional Tests: Category selection in template gallery
  // ===========================================================================

  describe('template category selection', () => {
    it('calls setCategory when category tab is clicked', async () => {
      const user = userEvent.setup();
      renderWithCoordinator(<EquationEditorDialog />);

      // Switch to Templates tab
      const templatesTab = screen.getByRole('tab', { name: 'Templates' });
      await user.click(templatesTab);

      // Wait for gallery to render
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Basic Math' })).toBeInTheDocument();
      });

      // Click Algebra category
      const algebraTab = screen.getByRole('tab', { name: 'Algebra' });
      await user.click(algebraTab);

      expect(mockSetCategory).toHaveBeenCalledWith('algebra');
    });
  });

  // ===========================================================================
  // Additional Tests: Quick help reference
  // ===========================================================================

  describe('quick help', () => {
    it('displays quick reference in Editor tab', () => {
      renderWithCoordinator(<EquationEditorDialog />);

      expect(screen.getByText('Quick reference:')).toBeInTheDocument();
    });
  });
});
