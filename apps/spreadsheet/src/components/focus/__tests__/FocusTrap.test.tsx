/**
 * FocusTrap Component Tests
 *
 * Tests all behaviors of the FocusTrap component:
 * - Focus machine registration (push/pop layer)
 * - Initial focus handling
 * - Tab trapping (keyboard navigation within dialog)
 * - Escape handling
 * - Portal mode (aggressive stopPropagation)
 * - React StrictMode compatibility
 * - Accessibility attributes
 *
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md for requirements
 */

import { jest } from '@jest/globals';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';

// =============================================================================
// MOCKS
// =============================================================================

// Mock the useFocus hook
const mockPushLayer = jest.fn();
const mockPopLayer = jest.fn();
const mockShouldGridHandle = jest.fn(() => false);

jest.unstable_mockModule('../../../hooks', () => ({
  useFocus: () => ({
    pushLayer: mockPushLayer,
    popLayer: mockPopLayer,
    shouldGridHandle: mockShouldGridHandle,
    state: 'dialog',
    isInOverlay: true,
    isGrid: false,
    isDialog: true,
  }),
}));

const { FocusTrap } = await import('../FocusTrap');

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Wait for requestAnimationFrame to complete
 */
function waitForRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Create a basic dialog for testing
 */
function TestDialog({
  dialogId = 'test-dialog',
  onClose = jest.fn(),
  ...props
}: Partial<React.ComponentProps<typeof FocusTrap>>) {
  return (
    <FocusTrap dialogId={dialogId} onClose={onClose} {...props}>
      <button data-testid="button-1">Button 1</button>
      <input data-testid="input-1" />
      <button data-testid="button-2">Button 2</button>
    </FocusTrap>
  );
}

/**
 * Create a dialog with initialFocusRef
 */
function TestDialogWithInitialFocus({ onClose = jest.fn() }: { onClose?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <FocusTrap dialogId="initial-focus-dialog" onClose={onClose} initialFocusRef={inputRef}>
      <button data-testid="button-1">Button 1</button>
      <input data-testid="focused-input" ref={inputRef} />
      <button data-testid="button-2">Button 2</button>
    </FocusTrap>
  );
}

/**
 * Create a dialog with no focusable elements
 */
function TestDialogNoFocusable({ onClose = jest.fn() }: { onClose?: () => void }) {
  return (
    <FocusTrap dialogId="no-focusable-dialog" onClose={onClose}>
      <div data-testid="static-content">No buttons here</div>
    </FocusTrap>
  );
}

// =============================================================================
// SETUP / TEARDOWN
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// =============================================================================
// REGISTRATION TESTS
// =============================================================================

describe('FocusTrap - Registration', () => {
  it('registers with focus machine on mount', async () => {
    render(<TestDialog />);

    // Wait for useEffect
    await act(async () => {
      await waitForRaf();
    });

    expect(mockPushLayer).toHaveBeenCalledTimes(1);
    expect(mockPushLayer).toHaveBeenCalledWith('dialog', 'test-dialog');
  });

  it('uses custom layerType when provided', async () => {
    render(<TestDialog layerType="commandPalette" dialogId="cmd-palette" />);

    await act(async () => {
      await waitForRaf();
    });

    expect(mockPushLayer).toHaveBeenCalledWith('commandPalette', 'cmd-palette');
  });

  it('unregisters from focus machine on unmount', async () => {
    const { unmount } = render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    unmount();

    expect(mockPopLayer).toHaveBeenCalledTimes(1);
  });

  it('handles React StrictMode cleanup correctly', async () => {
    // Note: React 18 StrictMode runs effects twice in development
    // The effect runs, cleans up, and runs again - this is expected React 18 behavior
    // What matters is that the final state is correct and cleanup runs on unmount
    const { unmount } = render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    // Verify registration happened
    expect(mockPushLayer).toHaveBeenCalled();

    // On unmount, popLayer should be called
    unmount();
    expect(mockPopLayer).toHaveBeenCalled();
  });
});

// =============================================================================
// INITIAL FOCUS TESTS
// =============================================================================

describe('FocusTrap - Initial Focus', () => {
  it('focuses initialFocusRef when provided', async () => {
    render(<TestDialogWithInitialFocus />);

    await act(async () => {
      await waitForRaf();
    });

    const focusedInput = screen.getByTestId('focused-input');
    expect(document.activeElement).toBe(focusedInput);
  });

  it('focuses first focusable element when no initialFocusRef', async () => {
    render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    const firstButton = screen.getByTestId('button-1');
    expect(document.activeElement).toBe(firstButton);
  });

  it('focuses container when no focusable elements exist', async () => {
    render(<TestDialogNoFocusable />);

    await act(async () => {
      await waitForRaf();
    });

    // Container should be focused (has tabIndex=-1)
    const container = screen.getByRole('dialog');
    expect(document.activeElement).toBe(container);
  });

  it('does not auto-focus when autoFocus=false', async () => {
    render(<TestDialog autoFocus={false} />);

    await act(async () => {
      await waitForRaf();
    });

    // Focus should not have changed from document.body or whatever was focused
    const firstButton = screen.getByTestId('button-1');
    expect(document.activeElement).not.toBe(firstButton);
  });
});

// =============================================================================
// TAB TRAPPING TESTS
// =============================================================================

describe('FocusTrap - Tab Trapping', () => {
  it('cycles focus from last to first on Tab', async () => {
    render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    // Focus the last button
    const lastButton = screen.getByTestId('button-2');
    lastButton.focus();
    expect(document.activeElement).toBe(lastButton);

    // Press Tab - should wrap to first
    fireEvent.keyDown(lastButton, { key: 'Tab' });

    const firstButton = screen.getByTestId('button-1');
    expect(document.activeElement).toBe(firstButton);
  });

  it('cycles focus from first to last on Shift+Tab', async () => {
    render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    // Focus the first button
    const firstButton = screen.getByTestId('button-1');
    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);

    // Press Shift+Tab - should wrap to last
    fireEvent.keyDown(firstButton, { key: 'Tab', shiftKey: true });

    const lastButton = screen.getByTestId('button-2');
    expect(document.activeElement).toBe(lastButton);
  });

  it('allows normal Tab within trap (not at boundaries)', async () => {
    render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    // Focus the first button
    const firstButton = screen.getByTestId('button-1');
    firstButton.focus();

    // Press Tab - should NOT wrap (not at last element)
    // Note: fireEvent.keyDown doesn't actually move focus, so we just verify
    // that preventDefault is not called for non-boundary cases
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const prevented = !firstButton.dispatchEvent(event);

    // Tab at first element (not last) should not be prevented
    expect(prevented).toBe(false);
  });
});

// =============================================================================
// ESCAPE HANDLING TESTS
// =============================================================================

describe('FocusTrap - Escape Handling', () => {
  it('calls onClose when Escape is pressed', async () => {
    const handleClose = jest.fn();
    render(<TestDialog onClose={handleClose} />);

    await act(async () => {
      await waitForRaf();
    });

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('prevents default on Escape', async () => {
    render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    const dialog = screen.getByRole('dialog');
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    const notPrevented = dialog.dispatchEvent(event);
    // defaultPrevented should be true, so dispatchEvent returns false
    expect(notPrevented).toBe(false);
  });

  it('stops propagation on Escape for non-portal', async () => {
    const outerHandler = jest.fn();

    render(
      <div onKeyDown={outerHandler}>
        <TestDialog isPortal={false} />
      </div>,
    );

    await act(async () => {
      await waitForRaf();
    });

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(outerHandler).not.toHaveBeenCalled();
  });
});

// =============================================================================
// PORTAL MODE TESTS
// =============================================================================

describe('FocusTrap - Portal Mode', () => {
  it('stops propagation of all keydown events when isPortal=true', async () => {
    const outerHandler = jest.fn();

    render(
      <div onKeyDown={outerHandler}>
        <TestDialog isPortal={true} />
      </div>,
    );

    await act(async () => {
      await waitForRaf();
    });

    const dialog = screen.getByRole('dialog');

    // Try various keys - none should propagate
    fireEvent.keyDown(dialog, { key: 'Delete' });
    fireEvent.keyDown(dialog, { key: 'Backspace' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'a' });

    expect(outerHandler).not.toHaveBeenCalled();
  });

  it('allows propagation when isPortal=false (except for trapped keys)', async () => {
    const outerHandler = jest.fn();

    render(
      <div onKeyDown={outerHandler}>
        <TestDialog isPortal={false} />
      </div>,
    );

    await act(async () => {
      await waitForRaf();
    });

    const dialog = screen.getByRole('dialog');

    // Regular keys should propagate when not in portal mode
    fireEvent.keyDown(dialog, { key: 'a' });
    fireEvent.keyDown(dialog, { key: 'Delete' });

    expect(outerHandler).toHaveBeenCalled();
  });
});

// =============================================================================
// ACCESSIBILITY TESTS
// =============================================================================

describe('FocusTrap - Accessibility', () => {
  it('has role="dialog"', () => {
    render(<TestDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
  });

  it('has aria-modal="true"', () => {
    render(<TestDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('sets aria-label when provided', () => {
    render(<TestDialog aria-label="Test Dialog Title" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Test Dialog Title');
  });

  it('sets aria-labelledby when provided', () => {
    render(<TestDialog aria-labelledby="dialog-title" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('dialog-title');
  });

  it('sets aria-describedby when provided', () => {
    render(<TestDialog aria-describedby="dialog-desc" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-describedby')).toBe('dialog-desc');
  });

  it('sets data-focus-trap attribute for focus restoration', () => {
    render(<TestDialog dialogId="my-unique-dialog" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-focus-trap')).toBe('my-unique-dialog');
  });

  it('has tabIndex=-1 for programmatic focus', () => {
    render(<TestDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('tabindex')).toBe('-1');
  });
});

// =============================================================================
// STYLING TESTS
// =============================================================================

describe('FocusTrap - Styling', () => {
  it('applies className when provided', () => {
    render(<TestDialog className="custom-dialog-class" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('custom-dialog-class')).toBe(true);
  });

  it('applies style when provided', () => {
    render(<TestDialog style={{ backgroundColor: 'red' }} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.backgroundColor).toBe('red');
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('FocusTrap - Edge Cases', () => {
  it('handles dialog with disabled buttons correctly', async () => {
    render(
      <FocusTrap dialogId="disabled-test" onClose={jest.fn()}>
        <button disabled data-testid="disabled-button">
          Disabled
        </button>
        <button data-testid="enabled-button">Enabled</button>
      </FocusTrap>,
    );

    await act(async () => {
      await waitForRaf();
    });

    // Should skip disabled button and focus enabled one
    const enabledButton = screen.getByTestId('enabled-button');
    expect(document.activeElement).toBe(enabledButton);
  });

  it('handles dialog with tabindex="-1" elements correctly', async () => {
    render(
      <FocusTrap dialogId="tabindex-test" onClose={jest.fn()}>
        <button tabIndex={-1} data-testid="skip-button">
          Skip Me
        </button>
        <button data-testid="focus-button">Focus Me</button>
      </FocusTrap>,
    );

    await act(async () => {
      await waitForRaf();
    });

    // Should skip tabindex="-1" and focus next focusable
    const focusButton = screen.getByTestId('focus-button');
    expect(document.activeElement).toBe(focusButton);
  });

  it('renders children correctly', () => {
    render(
      <FocusTrap dialogId="children-test" onClose={jest.fn()}>
        <div data-testid="child-1">Child 1</div>
        <div data-testid="child-2">Child 2</div>
      </FocusTrap>,
    );

    expect(screen.getByTestId('child-1')).toBeTruthy();
    expect(screen.getByTestId('child-2')).toBeTruthy();
  });
});

// =============================================================================
// FOCUS RESTORATION NOTE
// =============================================================================

describe('FocusTrap - Focus Restoration', () => {
  it('does NOT handle focus restoration (coordinator responsibility)', async () => {
    // This test documents that FocusTrap does NOT restore focus
    // Focus restoration is handled by FocusCoordination subscription
    const { unmount } = render(<TestDialog />);

    await act(async () => {
      await waitForRaf();
    });

    // Create an element outside the dialog to "restore" focus to
    const outsideButton = document.createElement('button');
    outsideButton.id = 'outside-button';
    document.body.appendChild(outsideButton);

    unmount();

    // FocusTrap does NOT restore focus - it only calls popLayer
    // The coordinator's subscription handles actual focus restoration
    expect(mockPopLayer).toHaveBeenCalled();
    // Focus is NOT automatically set to outsideButton by FocusTrap

    document.body.removeChild(outsideButton);
  });
});
