import { jest } from '@jest/globals';

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { RibbonDropdownItem } from './RibbonDropdown';

function renderMenu(callbacks?: { onFreeze?: jest.Mock; onTop?: jest.Mock; onBottom?: jest.Mock }) {
  const onFreeze = callbacks?.onFreeze ?? jest.fn();
  const onTop = callbacks?.onTop ?? jest.fn();
  const onBottom = callbacks?.onBottom ?? jest.fn();

  render(
    <div role="menu" aria-label="Freeze panes">
      <RibbonDropdownItem onClick={onFreeze}>Freeze Panes</RibbonDropdownItem>
      <RibbonDropdownItem disabled onClick={jest.fn()}>
        Filter
      </RibbonDropdownItem>
      <RibbonDropdownItem onClick={onTop}>Freeze Top Row</RibbonDropdownItem>
      <RibbonDropdownItem onClick={onBottom}>Freeze First Column</RibbonDropdownItem>
    </div>,
  );

  return {
    items: screen.getAllByRole('menuitem') as HTMLElement[],
    onFreeze,
    onTop,
    onBottom,
  };
}

describe('RibbonDropdownItem keyboard behavior', () => {
  it('moves focus with arrow keys and skips disabled items', () => {
    const { items } = renderMenu();

    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();

    fireEvent.keyDown(items[2], { key: 'ArrowDown' });
    expect(items[3]).toHaveFocus();

    fireEvent.keyDown(items[3], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[3]).toHaveFocus();
  });

  it('moves focus to menu edges with Home and End', () => {
    const { items } = renderMenu();

    items[2].focus();
    fireEvent.keyDown(items[2], { key: 'Home' });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[3]).toHaveFocus();
  });

  it('activates the first enabled matching item with printable accelerators', () => {
    const onFreeze = jest.fn();
    const { items } = renderMenu({ onFreeze });

    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'F' });
    expect(onFreeze).toHaveBeenCalledTimes(1);
  });

  it('does not treat modified printable keys as menu accelerators', () => {
    const onFreeze = jest.fn();
    const { items } = renderMenu({ onFreeze });

    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'f', ctrlKey: true });
    fireEvent.keyDown(items[0], { key: 'f', metaKey: true });
    fireEvent.keyDown(items[0], { key: 'f', altKey: true });

    expect(onFreeze).not.toHaveBeenCalled();
  });

  it('keeps Enter and Space activation working', () => {
    const onFreeze = jest.fn();
    const { items } = renderMenu({ onFreeze });

    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'Enter' });
    fireEvent.keyDown(items[0], { key: ' ' });

    expect(onFreeze).toHaveBeenCalledTimes(2);
  });
});
