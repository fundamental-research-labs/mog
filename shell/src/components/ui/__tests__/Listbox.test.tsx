/**
 * Listbox Primitive Tests
 *
 * Verifies the WAI-ARIA listbox contract:
 *   - role="listbox" + role="option" wiring with aria-selected
 *   - Roving tabindex (exactly one option carries tabIndex=0)
 *   - Selection-follows-focus on Arrow/Home/End
 *   - autoFocus targets the selected option on mount
 *   - Disabled options are skipped during navigation
 */

import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { Listbox, type ListboxItem } from '../Listbox';

const FRUITS: ListboxItem<'apple' | 'banana' | 'cherry' | 'durian'>[] = [
  { key: 'apple', label: 'Apple' },
  { key: 'banana', label: 'Banana' },
  { key: 'cherry', label: 'Cherry' },
  { key: 'durian', label: 'Durian' },
];

function ControlledListbox({
  initial = 'apple',
  autoFocus = false,
  items = FRUITS,
}: {
  initial?: 'apple' | 'banana' | 'cherry' | 'durian';
  autoFocus?: boolean;
  items?: typeof FRUITS;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <Listbox
      idPrefix="fruit"
      aria-label="Fruits"
      items={items}
      selectedKey={selected}
      onSelect={setSelected}
      autoFocus={autoFocus}
    />
  );
}

afterEach(cleanup);

describe('Listbox', () => {
  test('renders role=listbox with role=option children', () => {
    render(<ControlledListbox />);
    const listbox = screen.getByRole('listbox', { name: 'Fruits' });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(FRUITS.length);
  });

  test('selected option carries aria-selected and the only tabIndex=0', () => {
    render(<ControlledListbox initial="banana" />);
    const banana = screen.getByRole('option', { name: 'Banana' });
    expect(banana).toHaveAttribute('aria-selected', 'true');
    expect(banana).toHaveAttribute('tabindex', '0');

    const others = screen.getAllByRole('option').filter((el) => el !== banana);
    for (const opt of others) {
      expect(opt).toHaveAttribute('aria-selected', 'false');
      expect(opt).toHaveAttribute('tabindex', '-1');
    }
  });

  test('ArrowDown advances selection-follows-focus', () => {
    render(<ControlledListbox initial="apple" />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    const banana = screen.getByRole('option', { name: 'Banana' });
    expect(banana).toHaveAttribute('aria-selected', 'true');
    expect(banana).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(banana);
  });

  test('ArrowUp wraps from first to last', () => {
    render(<ControlledListbox initial="apple" />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });

    const durian = screen.getByRole('option', { name: 'Durian' });
    expect(durian).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(durian);
  });

  test('Home and End jump to the extremes', () => {
    render(<ControlledListbox initial="cherry" />);
    const listbox = screen.getByRole('listbox');

    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(listbox, { key: 'End' });
    expect(screen.getByRole('option', { name: 'Durian' })).toHaveAttribute('aria-selected', 'true');
  });

  test('autoFocus focuses the selected option on mount', () => {
    render(<ControlledListbox initial="cherry" autoFocus />);
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    expect(document.activeElement).toBe(cherry);
  });

  test('disabled options are skipped during navigation', () => {
    const items: ListboxItem<'a' | 'b' | 'c'>[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', disabled: true },
      { key: 'c', label: 'C' },
    ];
    function Wrapper() {
      const [selected, setSelected] = useState<'a' | 'b' | 'c'>('a');
      return (
        <Listbox
          idPrefix="x"
          items={items}
          selectedKey={selected}
          onSelect={setSelected}
          aria-label="Letters"
        />
      );
    }
    render(<Wrapper />);
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    expect(screen.getByRole('option', { name: 'C' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking an option selects it and moves focus', () => {
    render(<ControlledListbox initial="apple" />);
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    fireEvent.click(cherry);
    expect(cherry).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(cherry);
  });

  test('option ids follow the configured idPrefix', () => {
    render(<ControlledListbox />);
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute(
      'id',
      'fruit-option-apple',
    );
  });
});
