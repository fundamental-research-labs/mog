import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { ValueFilterList } from '../ValueFilterList';

describe('ValueFilterList', () => {
  it('applies only visible searched values when no existing filter is being edited', () => {
    const onApply = jest.fn();

    render(
      <ValueFilterList
        items={[
          { value: 'East', displayText: 'East', count: 1, selected: true },
          { value: 'North', displayText: 'North', count: 1, selected: true },
          { value: 'West', displayText: 'West', count: 2, selected: true },
        ]}
        hasBlank={false}
        blankCount={0}
        blankSelected={false}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'West' },
    });

    fireEvent.click(screen.getByTestId('filter-value-clear'));
    expect(screen.getByTestId('filter-value-apply')).toBeDisabled();

    fireEvent.click(screen.getByText('West'));
    fireEvent.click(screen.getByTestId('filter-value-apply'));

    expect(onApply).toHaveBeenCalledWith({ values: ['West'], includeBlanks: false });
  });

  it('search apply ignores hidden initially-selected values before a column filter exists', () => {
    const onApply = jest.fn();

    render(
      <ValueFilterList
        items={[
          { value: 'East', displayText: 'East', count: 1, selected: true },
          { value: 'North', displayText: 'North', count: 1, selected: true },
          { value: 'West', displayText: 'West', count: 2, selected: true },
        ]}
        hasBlank={false}
        blankCount={0}
        blankSelected={false}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'West' },
    });
    fireEvent.click(screen.getByTestId('filter-value-apply'));

    expect(onApply).toHaveBeenCalledWith({ values: ['West'], includeBlanks: false });
  });

  it('preserves hidden checklist values when Clear and Select All run under search', () => {
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
        preserveHiddenSearchSelections={true}
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

    expect(screen.getByTestId('filter-value-blank')).toBeChecked();

    fireEvent.change(screen.getByPlaceholderText('Search (* and ? wildcards)'), {
      target: { value: 'Apple' },
    });
    fireEvent.click(screen.getByTestId('filter-value-select-all'));
    fireEvent.click(screen.getByTestId('filter-value-apply'));

    expect(onApply).toHaveBeenCalledWith({ values: ['Apple'], includeBlanks: true });
  });

  it('applies Clear and Select All to the full checklist when search is empty', () => {
    const onApply = jest.fn();

    render(
      <ValueFilterList
        items={[
          { value: 'Apple', displayText: 'Apple', count: 2, selected: true },
          { value: 'Banana', displayText: 'Banana', count: 1, selected: true },
        ]}
        hasBlank={true}
        blankCount={2}
        blankSelected={true}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-value-clear'));

    expect(screen.getByTestId('filter-value-blank')).not.toBeChecked();
    expect(screen.getByTestId('filter-value-apply')).toBeDisabled();

    fireEvent.click(screen.getByTestId('filter-value-select-all'));
    fireEvent.click(screen.getByTestId('filter-value-apply'));

    expect(onApply).toHaveBeenCalledWith({
      values: ['Apple', 'Banana'],
      includeBlanks: true,
    });
  });
});
