import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { isEnterKeyDefaultAction, shouldPreventDialogInteractOutside } from '../Dialog';

function buildEvent({
  key = 'Enter',
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  defaultPrevented = false,
  target,
}: {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target: HTMLElement;
}): ReactKeyboardEvent<HTMLElement> {
  return {
    key,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    defaultPrevented,
    target,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as ReactKeyboardEvent<HTMLElement>;
}

function el(tag: string, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

describe('isEnterKeyDefaultAction', () => {
  it('returns false for keys other than Enter', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ key: 'a', target: el('div') }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ key: 'Escape', target: el('div') }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ key: ' ', target: el('div') }))).toBe(false);
  });

  it('returns false when any modifier is held (Ctrl+Enter, Shift+Enter, etc.)', () => {
    const target = el('div');
    expect(isEnterKeyDefaultAction(buildEvent({ shiftKey: true, target }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ ctrlKey: true, target }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ metaKey: true, target }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ altKey: true, target }))).toBe(false);
  });

  it('returns false when the event is already defaultPrevented', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ defaultPrevented: true, target: el('div') }))).toBe(
      false,
    );
  });

  it('suppresses native controls where Enter has its own semantics', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('textarea') }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('select') }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('a') }))).toBe(false);
  });

  it('suppresses contenteditable elements', () => {
    const editable = el('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEnterKeyDefaultAction(buildEvent({ target: editable }))).toBe(false);
  });

  it('suppresses on tab triggers and menu items (explicit roles)', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('div', { role: 'tab' }) }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('div', { role: 'menuitem' }) }))).toBe(
      false,
    );
    expect(
      isEnterKeyDefaultAction(buildEvent({ target: el('div', { role: 'menuitemcheckbox' }) })),
    ).toBe(false);
    expect(
      isEnterKeyDefaultAction(buildEvent({ target: el('div', { role: 'menuitemradio' }) })),
    ).toBe(false);
  });

  it('suppresses on plain action buttons (Cancel/OK/Apply in DialogFooter)', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('button') }))).toBe(false);
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('div', { role: 'button' }) }))).toBe(
      false,
    );
  });

  it('FIRES on listbox option buttons (Excel-parity carve-out)', () => {
    const listbox = el('div', { role: 'listbox' });
    const option = el('button', { role: 'option' }, listbox);
    expect(isEnterKeyDefaultAction(buildEvent({ target: option }))).toBe(true);
  });

  it('FIRES on radio buttons inside a radiogroup', () => {
    const group = el('div', { role: 'radiogroup' });
    const radio = el('button', { role: 'radio' }, group);
    expect(isEnterKeyDefaultAction(buildEvent({ target: radio }))).toBe(true);
  });

  it('FIRES on tree items', () => {
    const tree = el('div', { role: 'tree' });
    const item = el('div', { role: 'treeitem' }, tree);
    expect(isEnterKeyDefaultAction(buildEvent({ target: item }))).toBe(true);
  });

  it('FIRES when target is a plain div with no special role', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('div') }))).toBe(true);
  });

  it('FIRES when target is the dialog content (Radix sets role="dialog" on Content)', () => {
    expect(
      isEnterKeyDefaultAction(
        buildEvent({ target: el('div', { role: 'dialog', 'data-dialog-id': 'x' }) }),
      ),
    ).toBe(true);
  });

  it('suppresses on a child element of a custom role="button" (e.g. icon inside StylePreview)', () => {
    const stylePreview = el('div', { role: 'button', tabindex: '0' });
    const icon = el('span', {}, stylePreview);
    expect(isEnterKeyDefaultAction(buildEvent({ target: icon }))).toBe(false);
  });

  it('FIRES on inputs (numeric, text — Enter commits)', () => {
    expect(isEnterKeyDefaultAction(buildEvent({ target: el('input') }))).toBe(true);
  });

  it('suppresses a custom role="button" element (StylePreview pattern)', () => {
    // InsertTableDialog StylePreview: a div with role="button" + tabIndex.
    // Enter on it activates the button (selects style); should NOT also commit.
    const stylePreview = el('div', { role: 'button', tabindex: '0' });
    expect(isEnterKeyDefaultAction(buildEvent({ target: stylePreview }))).toBe(false);
  });

  it('FIRES when target is nested inside a listbox option (e.g. an icon span)', () => {
    const listbox = el('div', { role: 'listbox' });
    const option = el('button', { role: 'option' }, listbox);
    const icon = el('span', {}, option);
    // Even though the BUTTON tag matches, the closest option ancestor wins.
    expect(isEnterKeyDefaultAction(buildEvent({ target: icon }))).toBe(true);
  });

  it('handles missing target gracefully', () => {
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as ReactKeyboardEvent<HTMLElement>;
    expect(isEnterKeyDefaultAction(event)).toBe(true);
  });
});

describe('shouldPreventDialogInteractOutside', () => {
  function outsideEvent(
    originalEvent: Event,
  ): Parameters<typeof shouldPreventDialogInteractOutside>[0] {
    return {
      detail: { originalEvent },
      preventDefault: () => {},
    } as Parameters<typeof shouldPreventDialogInteractOutside>[0];
  }

  it('prevents focus-outside dismissal even when overlay click dismissal is enabled', () => {
    expect(shouldPreventDialogInteractOutside(outsideEvent(new FocusEvent('focusin')), true)).toBe(
      true,
    );
  });

  it('allows pointer-outside dismissal when overlay click dismissal is enabled', () => {
    expect(shouldPreventDialogInteractOutside(outsideEvent(new Event('pointerdown')), true)).toBe(
      false,
    );
  });

  it('prevents every outside interaction when overlay click dismissal is disabled', () => {
    expect(shouldPreventDialogInteractOutside(outsideEvent(new Event('pointerdown')), false)).toBe(
      true,
    );
  });
});
