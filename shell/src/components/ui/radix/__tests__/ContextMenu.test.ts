import '@testing-library/jest-dom';

import { createElement } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toAriaKeyShortcuts } from '../ContextMenu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ContextMenu';

describe('ContextMenu shortcut accessibility', () => {
  it('normalizes compact macOS shortcut symbols for aria-keyshortcuts', () => {
    expect(toAriaKeyShortcuts('\u23181')).toBe('Meta+1');
    expect(toAriaKeyShortcuts('\u21E7\u2318F')).toBe('Shift+Meta+F');
    expect(toAriaKeyShortcuts('\u2325\u2318C')).toBe('Alt+Meta+C');
  });

  it('normalizes written shortcut modifiers for aria-keyshortcuts', () => {
    expect(toAriaKeyShortcuts('Cmd+1')).toBe('Meta+1');
    expect(toAriaKeyShortcuts('Ctrl+Shift+O')).toBe('Control+Shift+O');
  });

  it('separates label and shortcut in DOM text while keeping shortcut out of the name', async () => {
    render(
      createElement(
        ContextMenu,
        null,
        createElement(ContextMenuTrigger, null, 'Target'),
        createElement(
          ContextMenuContent,
          null,
          createElement(ContextMenuItem, { shortcut: 'Alt+Shift+\u2192' }, 'Group columns'),
        ),
      ),
    );

    fireEvent.contextMenu(screen.getByText('Target'));

    const item = await waitFor(() => screen.getByRole('menuitem', { name: 'Group columns' }));

    expect(item).toHaveTextContent('Group columns Alt+Shift+\u2192');
  });
});
