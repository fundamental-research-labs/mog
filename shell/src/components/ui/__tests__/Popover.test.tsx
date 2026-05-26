/**
 * Popover Primitive Tests
 *
 * Comprehensive tests for the Popover component - the single source of truth
 * for all floating UI elements in the codebase.
 *
 * Tests cover:
 * - Basic rendering (trigger, content, portal)
 * - Positioning (side, align, sideOffset)
 * - Dismiss behavior (click outside, escape, scroll)
 * - Virtual positioning (PopoverAnchor)
 * - Nesting (z-index, closeAll)
 * - PopoverClose
 * - Styling variants
 */

import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';

import {
  createVirtualRef,
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  usePopoverClose,
} from '../radix/Popover';

// =============================================================================
// NOTE: Radix Popover uses @floating-ui/react-dom internally
// We don't mock Floating UI here - tests verify behavior, not implementation
// =============================================================================

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Basic controlled popover for testing
 */
function TestPopover({
  initialOpen = false,
  contentProps = {},
  triggerProps = {},
  children = <div>Popover Content</div>,
}: {
  initialOpen?: boolean;
  contentProps?: Partial<React.ComponentProps<typeof PopoverContent>>;
  triggerProps?: Partial<React.ComponentProps<typeof PopoverTrigger>>;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...triggerProps}>
        <button data-testid="trigger">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent data-testid="content" {...contentProps}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Controlled popover with external state for testing callbacks
 */
function ControlledPopover({
  open,
  onOpenChange,
  contentProps = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentProps?: Partial<React.ComponentProps<typeof PopoverContent>>;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button data-testid="trigger">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent data-testid="content" {...contentProps}>
        <div>Popover Content</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Popover with virtual anchor (context menu style)
 */
function VirtualPopover({
  initialOpen = false,
  virtualRef = { current: createVirtualRef(150, 250) },
}: {
  initialOpen?: boolean;
  virtualRef?: { current: ReturnType<typeof createVirtualRef> };
}) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent data-testid="content">
        <div>Context Menu Content</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Nested popovers for z-index and closeAll testing
 */
function NestedPopovers({
  outerOpen = false,
  innerOpen = false,
}: {
  outerOpen?: boolean;
  innerOpen?: boolean;
}) {
  const [outer, setOuter] = useState(outerOpen);
  const [inner, setInner] = useState(innerOpen);

  return (
    <Popover open={outer} onOpenChange={setOuter}>
      <PopoverTrigger asChild>
        <button data-testid="outer-trigger">Open Outer</button>
      </PopoverTrigger>
      <PopoverContent data-testid="outer-content">
        <div>Outer Content</div>
        <Popover open={inner} onOpenChange={setInner}>
          <PopoverTrigger asChild>
            <button data-testid="inner-trigger">Open Inner</button>
          </PopoverTrigger>
          <PopoverContent data-testid="inner-content">
            <div>Inner Content</div>
            <PopoverClose closeAll asChild>
              <button data-testid="close-all-btn">Close All</button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Popover with PopoverClose component
 */
function PopoverWithClose({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="trigger">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent data-testid="content">
        <div>Content</div>
        <PopoverClose>
          <button data-testid="close-btn">Close</button>
        </PopoverClose>
        <PopoverClose asChild>
          <button data-testid="close-btn-aschild">Close asChild</button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Component using usePopoverClose hook
 */
function ContentWithCloseHook() {
  const { closeAll } = usePopoverClose();
  return (
    <>
      <button data-testid="hook-close" onClick={closeAll}>
        Hook Close
      </button>
      <button data-testid="hook-close-all" onClick={closeAll}>
        Hook Close All
      </button>
    </>
  );
}

function PopoverWithCloseHook({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="trigger">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent data-testid="content">
        <ContentWithCloseHook />
      </PopoverContent>
    </Popover>
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
  jest.useRealTimers();
});

// =============================================================================
// BASIC RENDERING TESTS
// =============================================================================

describe('Popover - Basic Rendering', () => {
  it('renders trigger element', () => {
    render(<TestPopover />);

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Open Popover');
  });

  it('content is hidden when closed', () => {
    render(<TestPopover initialOpen={false} />);

    expect(screen.queryByText('Popover Content')).not.toBeInTheDocument();
  });

  it('content appears when open=true', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });
  });

  it('content renders in portal (document.body)', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content');
      expect(content.closest('body > div')).toBeTruthy();
    });
  });

  it('content opts into pointer events when mounted in a pointer-transparent portal host', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('content')).toHaveClass('pointer-events-auto');
    });
  });

  it('toggling trigger opens/closes popover', async () => {
    render(<TestPopover initialOpen={false} />);

    const trigger = screen.getByTestId('trigger');

    // Initially closed
    expect(screen.queryByText('Popover Content')).not.toBeInTheDocument();

    // Click to open
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });

    // Click to close
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.queryByText('Popover Content')).not.toBeInTheDocument();
    });
  });

  // Note: forceMount behavior varies by Radix version.
  // The prop is passed through but Radix may still not render when closed.
  // This is tested indirectly by animations that need the element in DOM before exit.
});

// =============================================================================
// POSITIONING TESTS
// Note: Radix handles positioning internally via @floating-ui/react-dom
// We test that props are passed correctly by checking the rendered content attributes
// =============================================================================

describe('Popover - Positioning', () => {
  it('renders content with positioning when open', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content');
      expect(content).toBeInTheDocument();
    });
  });

  it('accepts side and align props without error', async () => {
    render(<TestPopover initialOpen={true} contentProps={{ side: 'top', align: 'end' }} />);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });
  });

  it('accepts sideOffset prop without error', async () => {
    render(<TestPopover initialOpen={true} contentProps={{ sideOffset: 10 }} />);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });
  });
});

// =============================================================================
// DISMISS BEHAVIOR TESTS
// =============================================================================

describe('Popover - Dismiss Behavior', () => {
  describe('Click Outside', () => {
    it('click outside closes popover when closeOnClickOutside=true (default)', async () => {
      const handleOpenChange = jest.fn();

      render(<ControlledPopover open={true} onOpenChange={handleOpenChange} />);

      await waitFor(() => {
        expect(screen.getByText('Popover Content')).toBeInTheDocument();
      });

      // Click outside - Radix uses pointerdown
      fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' });

      await waitFor(() => {
        expect(handleOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('click outside does NOT close when closeOnClickOutside=false', async () => {
      const handleOpenChange = jest.fn();

      render(
        <ControlledPopover
          open={true}
          onOpenChange={handleOpenChange}
          contentProps={{ closeOnClickOutside: false }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Popover Content')).toBeInTheDocument();
      });

      fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' });

      // Give some time for potential handler to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handleOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('click on content does not close popover', async () => {
      const handleOpenChange = jest.fn();

      render(<ControlledPopover open={true} onOpenChange={handleOpenChange} />);

      await waitFor(() => {
        expect(screen.getByText('Popover Content')).toBeInTheDocument();
      });

      const content = screen.getByText('Popover Content');
      fireEvent.pointerDown(content, { button: 0, pointerType: 'mouse' });

      // Give some time for potential handler to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handleOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('Escape Key', () => {
    it('escape key closes popover when closeOnEscape=true (default)', async () => {
      const handleOpenChange = jest.fn();

      render(<ControlledPopover open={true} onOpenChange={handleOpenChange} />);

      await waitFor(() => {
        expect(screen.getByText('Popover Content')).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(handleOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('escape key does NOT close when closeOnEscape=false', async () => {
      const handleOpenChange = jest.fn();

      render(
        <ControlledPopover
          open={true}
          onOpenChange={handleOpenChange}
          contentProps={{ closeOnEscape: false }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Popover Content')).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      // Give some time for potential handler to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handleOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  // Note: closeOnScroll is not supported in Radix Popover API
  // Scroll handling is done automatically via autoUpdate in Floating UI
});

// =============================================================================
// VIRTUAL POSITIONING (PopoverAnchor) TESTS
// =============================================================================

describe('Popover - Virtual Positioning (PopoverAnchor)', () => {
  it('renders content when using virtual anchor', async () => {
    const virtualRef = { current: createVirtualRef(300, 400) };

    render(<VirtualPopover initialOpen={true} virtualRef={virtualRef} />);

    await waitFor(() => {
      expect(screen.getByText('Context Menu Content')).toBeInTheDocument();
    });
  });

  it('works without a trigger element', async () => {
    render(<VirtualPopover initialOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText('Context Menu Content')).toBeInTheDocument();
    });
  });

  it('createVirtualRef returns proper getBoundingClientRect', () => {
    const ref = createVirtualRef(300, 400);
    const rect = ref.getBoundingClientRect();

    expect(rect.x).toBe(300);
    expect(rect.y).toBe(400);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(rect.top).toBe(400);
    expect(rect.left).toBe(300);
    expect(rect.right).toBe(300);
    expect(rect.bottom).toBe(400);
  });
});

// =============================================================================
// NESTING TESTS
// =============================================================================

describe('Popover - Nesting', () => {
  it('nested popovers render correctly', async () => {
    render(<NestedPopovers outerOpen={true} innerOpen={true} />);

    await waitFor(() => {
      // Find content by their text content
      expect(screen.getByText('Outer Content')).toBeInTheDocument();
      expect(screen.getByText('Inner Content')).toBeInTheDocument();
    });
  });

  it('closeAll closes entire tree', async () => {
    function NestedWithCloseAll() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);

      return (
        <div data-testid="root">
          <Popover open={outer} onOpenChange={setOuter}>
            <PopoverTrigger asChild>
              <button>Outer</button>
            </PopoverTrigger>
            <PopoverContent>
              <div data-testid="outer-content">Outer Content</div>
              <Popover open={inner} onOpenChange={setInner}>
                <PopoverTrigger asChild>
                  <button>Inner</button>
                </PopoverTrigger>
                <PopoverContent>
                  <div data-testid="inner-content">Inner Content</div>
                  <PopoverClose closeAll asChild>
                    <button data-testid="close-all">Close All</button>
                  </PopoverClose>
                </PopoverContent>
              </Popover>
            </PopoverContent>
          </Popover>
        </div>
      );
    }

    render(<NestedWithCloseAll />);

    // Both should be open initially
    await waitFor(() => {
      expect(screen.getByTestId('outer-content')).toBeInTheDocument();
      expect(screen.getByTestId('inner-content')).toBeInTheDocument();
    });

    // Click closeAll button
    fireEvent.click(screen.getByTestId('close-all'));

    // Both should be closed
    await waitFor(() => {
      expect(screen.queryByTestId('outer-content')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inner-content')).not.toBeInTheDocument();
    });
  });
});

// =============================================================================
// POPOVERCLOSE TESTS
// =============================================================================

describe('Popover - PopoverClose', () => {
  it('clicking closes the popover', async () => {
    render(<PopoverWithClose initialOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('close-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('close-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  it('asChild merges with child element', async () => {
    render(<PopoverWithClose initialOpen={true} />);

    await waitFor(() => {
      const closeBtn = screen.getByTestId('close-btn-aschild');
      expect(closeBtn).toBeInTheDocument();
      expect(closeBtn.tagName).toBe('BUTTON');
    });

    // Click should still close
    fireEvent.click(screen.getByTestId('close-btn-aschild'));

    await waitFor(() => {
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  it('without asChild wraps in button by default (Radix behavior)', async () => {
    render(<PopoverWithClose initialOpen={true} />);

    await waitFor(() => {
      const closeBtn = screen.getByTestId('close-btn');
      // Radix PopoverClose without asChild renders as a button by default
      expect(closeBtn.parentElement?.tagName).toBe('BUTTON');
    });
  });

  it('usePopoverClose hook provides closeAll function', async () => {
    render(<PopoverWithCloseHook initialOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('hook-close-all')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hook-close-all'));

    await waitFor(() => {
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });
});

// =============================================================================
// STYLING VARIANTS TESTS
// Note: These tests verify styling props that will be added to PopoverContent.
// They are commented out until the Popover component is updated with those props.
// =============================================================================

describe('Popover - Styling Variants', () => {
  describe('className prop', () => {
    it('applies custom className', async () => {
      render(
        <TestPopover initialOpen={true} contentProps={{ className: 'custom-popover-class' }} />,
      );

      await waitFor(() => {
        const content = screen.getByText('Popover Content').parentElement;
        expect(content).toHaveClass('custom-popover-class');
      });
    });
  });

  // TODO: Enable these tests after PopoverContent is updated with shadow, rounded, width props
  // describe('shadow prop', () => { ... });
  // describe('rounded prop', () => { ... });
  // describe('width prop', () => { ... });
});

// =============================================================================
// TRIGGER TESTS
// =============================================================================

describe('Popover - PopoverTrigger', () => {
  it('asChild merges props with child element', () => {
    render(<TestPopover triggerProps={{ asChild: true }} />);

    const trigger = screen.getByTestId('trigger');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('without asChild wraps in button (Radix default)', () => {
    render(<TestPopover triggerProps={{ asChild: false }} />);

    const trigger = screen.getByTestId('trigger');
    // Radix wraps in a button by default when asChild is false
    expect(trigger.parentElement?.tagName).toBe('BUTTON');
  });

  it('sets aria-expanded based on open state', async () => {
    render(<TestPopover initialOpen={false} triggerProps={{ asChild: true }} />);

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('has aria-controls attribute', async () => {
    // Radix always sets aria-controls on the trigger
    render(<TestPopover initialOpen={false} triggerProps={{ asChild: true }} />);

    const trigger = screen.getByTestId('trigger');
    // Radix sets aria-controls even when closed
    expect(trigger).toHaveAttribute('aria-controls');
  });

  it('forwards onClick to child when asChild', async () => {
    const childOnClick = jest.fn();

    function TestWithChildClick() {
      const [open, setOpen] = useState(false);

      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button data-testid="trigger" onClick={childOnClick}>
              Open
            </button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );
    }

    render(<TestWithChildClick />);

    fireEvent.click(screen.getByTestId('trigger'));

    expect(childOnClick).toHaveBeenCalled();
  });
});

// =============================================================================
// ARIA & ACCESSIBILITY TESTS
// =============================================================================

describe('Popover - Accessibility', () => {
  it('content has role="dialog" by default', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content').parentElement;
      expect(content).toHaveAttribute('role', 'dialog');
    });
  });

  it('respects custom role prop', async () => {
    render(<TestPopover initialOpen={true} contentProps={{ role: 'menu' }} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content').parentElement;
      expect(content).toHaveAttribute('role', 'menu');
    });
  });

  it('supports aria-label prop', async () => {
    render(<TestPopover initialOpen={true} contentProps={{ 'aria-label': 'Custom label' }} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content').parentElement;
      expect(content).toHaveAttribute('aria-label', 'Custom label');
    });
  });

  it('has unique id for ARIA relationships', async () => {
    render(<TestPopover initialOpen={true} />);

    await waitFor(() => {
      const content = screen.getByText('Popover Content').parentElement;
      expect(content).toHaveAttribute('id');
      expect(content?.id).toBeTruthy();
    });
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Popover - Error Handling', () => {
  it('throws error when PopoverContent used outside Popover', () => {
    // Suppress console.error for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // PopoverContent uses Portal internally, which throws first
    expect(() => {
      render(<PopoverContent>Content</PopoverContent>);
    }).toThrow('must be used within `Popover`');

    consoleSpy.mockRestore();
  });

  it('throws error when PopoverTrigger used outside Popover', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <PopoverTrigger>
          <button>Trigger</button>
        </PopoverTrigger>,
      );
    }).toThrow('must be used within `Popover`');

    consoleSpy.mockRestore();
  });

  it('throws error when PopoverClose used outside Popover', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <PopoverClose>
          <button>Close</button>
        </PopoverClose>,
      );
    }).toThrow('must be used within `Popover`');

    consoleSpy.mockRestore();
  });

  it('throws error when PopoverAnchor used outside Popover', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<PopoverAnchor virtualRef={{ current: createVirtualRef(0, 0) }} />);
    }).toThrow('must be used within `Popover`');

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// CLEANUP TESTS
// =============================================================================

describe('Popover - Cleanup', () => {
  it('content is removed from DOM when closed', async () => {
    const { rerender } = render(<ControlledPopover open={true} onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });

    rerender(<ControlledPopover open={false} onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText('Popover Content')).not.toBeInTheDocument();
    });
  });

  it('can be unmounted without errors', async () => {
    const { unmount } = render(<ControlledPopover open={true} onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Popover Content')).toBeInTheDocument();
    });

    // Should unmount cleanly without throwing
    expect(() => unmount()).not.toThrow();
  });
});
