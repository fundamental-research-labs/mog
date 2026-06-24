import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { ValueFilterList } from '../ValueFilterList';

describe('ValueFilterList', () => {
  it('applies Clear and Select All to the full checklist while search is narrowed', () => {
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

    expect(screen.getByTestId('filter-value-blank')).toBeChecked();

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'Apple' },
    });

    fireEvent.click(screen.getByTestId('filter-value-clear'));

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: '' },
    });

    expect(screen.getByTestId('filter-value-blank')).not.toBeChecked();

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'Apple' },
    });
    fireEvent.click(screen.getByTestId('filter-value-select-all'));

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: '' },
    });

    expect(screen.getByTestId('filter-value-blank')).toBeChecked();
  });
});
