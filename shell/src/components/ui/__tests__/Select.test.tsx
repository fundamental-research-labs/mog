/**
 * Select Primitive Tests
 *
 * Locks the wrapper contract around Radix Select values. Radix reserves the
 * empty string for "clear selection", but Mog callers use `value: ''` for real
 * choices like "(none)" and "Automatic". The wrapper must keep that public API
 * while never passing an empty item value to Radix.
 */

import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';

import { Select, type SelectOption } from '../radix/Select';

afterEach(cleanup);

describe('Select', () => {
  test('supports a real empty-string option without tripping Radix Select.Item', () => {
    const options: SelectOption[] = [
      { value: '', label: '(none)' },
      { value: 'page', label: 'Page &[Page]' },
    ];

    expect(() => {
      render(<Select aria-label="Header Preset" options={options} value="" onChange={jest.fn()} />);
    }).not.toThrow();

    expect(screen.getByRole('combobox', { name: 'Header Preset' })).toHaveAttribute(
      'data-value',
      '',
    );
  });
});
