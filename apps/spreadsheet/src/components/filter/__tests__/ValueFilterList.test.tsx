import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { ValueFilterList } from '../ValueFilterList';

describe('ValueFilterList', () => {
  it('keeps hidden blank selection when searched Clear and Select All operate on visible values', () => {
    const onApply = jest.fn();

    render(
      <ValueFilterList
        items={[
          { value: 'Apple', displayText: 'Apple', count: 2, selected: false },
          { value: 'Banana', displayText: 'Banana', count: 1, selected: false },
        ]}
        hasBlank={true}
        blankCount={2}
        blankSelected={true}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'Apple' },
    });

    fireEvent.click(screen.getByTestId('filter-value-clear'));
    fireEvent.click(screen.getByTestId('filter-value-select-all'));

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: '' },
    });

    expect(screen.getByTestId('filter-value-blank')).toBeChecked();
  });
});
