/**
 * TabContextMenu Tests — Workbook Structure Protection
 *
 * Verifies that menu items are disabled when workbook structure protection is on,
 * and that Protect Sheet remains enabled (sheet-level, independent).
 */

import { jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react';

// =============================================================================
// Mocks
// =============================================================================

// Mock internal-api (dispatch + useActionDependencies)
jest.unstable_mockModule('../../../internal-api', () => ({
  dispatch: jest.fn(),
  useActionDependencies: () => ({
    uiStore: {
      getState: () => ({
        setPendingProtectSheetId: jest.fn(),
      }),
    },
  }),
}));

// Mock @mog/shell — Popover family renders children directly for testing
jest.unstable_mockModule('@mog/shell', () => ({
  createVirtualRef: () => ({
    current: {
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    },
  }),
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="popover">{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverContent: ({
    children,
    align: _align,
    side: _side,
    sideOffset: _sideOffset,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: any;
  }) => <div {...props}>{children}</div>,
}));

// Mock TabColorPicker
jest.unstable_mockModule('../TabColorPicker', () => ({
  TabColorPicker: () => null,
}));

const { TabContextMenu } = await import('../TabContextMenu');

// =============================================================================
// Helpers
// =============================================================================

const noop = () => {};

const defaultProps = {
  x: 100,
  y: 100,
  isOpen: true,
  sheetId: 'sheet1',
  visibleSheetCount: 3,
  hiddenSheetCount: 1,
  selectedSheetCount: 1,
  onClose: noop,
  onInsert: noop,
  onDelete: noop,
  onRename: noop,
  onCopy: noop,
  onHide: noop,
  onUnhide: noop,
  onSetTabColor: noop,
  onOpenMoveOrCopy: noop,
};

function getMenuItems(): HTMLButtonElement[] {
  return Array.from(screen.queryAllByRole('menuitem')) as HTMLButtonElement[];
}

function findMenuItem(label: string): HTMLButtonElement | undefined {
  return getMenuItems().find((item) => item.textContent?.includes(label));
}

// =============================================================================
// Tests
// =============================================================================

describe('TabContextMenu — workbook structure protection', () => {
  it('disables Insert when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const insert = findMenuItem('Insert');
    expect(insert).toBeDefined();
    expect(insert!.disabled).toBe(true);
  });

  it('disables Delete when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const del = findMenuItem('Delete');
    expect(del).toBeDefined();
    expect(del!.disabled).toBe(true);
  });

  it('disables Rename when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const rename = findMenuItem('Rename');
    expect(rename).toBeDefined();
    expect(rename!.disabled).toBe(true);
  });

  it('disables Move or Copy when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const move = findMenuItem('Move or Copy...');
    expect(move).toBeDefined();
    expect(move!.disabled).toBe(true);
  });

  it('disables Duplicate when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const duplicate = findMenuItem('Duplicate');
    expect(duplicate).toBeDefined();
    expect(duplicate!.disabled).toBe(true);
  });

  it('disables Hide when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const hide = findMenuItem('Hide');
    expect(hide).toBeDefined();
    expect(hide!.disabled).toBe(true);
  });

  it('disables Unhide when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const unhide = findMenuItem('Unhide...');
    expect(unhide).toBeDefined();
    expect(unhide!.disabled).toBe(true);
  });

  it('disables Tab Color when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const tabColor = findMenuItem('Tab Color');
    expect(tabColor).toBeDefined();
    expect(tabColor!.disabled).toBe(true);
  });

  it('does NOT disable Protect Sheet when workbook structure is protected', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={true} />);
    const protectSheet = findMenuItem('Protect Sheet...');
    expect(protectSheet).toBeDefined();
    expect(protectSheet!.disabled).toBeFalsy();
  });

  it('enables all structure items when protection is off', () => {
    render(<TabContextMenu {...defaultProps} isWorkbookStructureProtected={false} />);

    expect(findMenuItem('Insert')!.disabled).toBeFalsy();
    expect(findMenuItem('Rename')!.disabled).toBeFalsy();
    expect(findMenuItem('Move or Copy...')!.disabled).toBeFalsy();
    expect(findMenuItem('Duplicate')!.disabled).toBeFalsy();
    // Delete and Hide require visibleSheetCount > 1 (which is 3 in defaults)
    expect(findMenuItem('Delete')!.disabled).toBeFalsy();
    expect(findMenuItem('Hide')!.disabled).toBeFalsy();
    // Unhide requires hiddenSheetCount > 0 (which is 1 in defaults)
    expect(findMenuItem('Unhide...')!.disabled).toBeFalsy();
  });
});
