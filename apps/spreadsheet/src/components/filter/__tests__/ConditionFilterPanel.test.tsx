import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { ConditionFilterPanel } from '../ConditionFilterPanel';

describe('ConditionFilterPanel', () => {
  it('uses the operator selected from the filter submenu as the initial condition', () => {
    const onApply = jest.fn();

    render(<ConditionFilterPanel initialOperator="greaterThan" onApply={onApply} />);

    const operator = screen.getByTestId('filter-condition-operator') as HTMLSelectElement;
    expect(operator.value).toBe('greaterThan');

    fireEvent.change(screen.getByTestId('filter-condition-value'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByTestId('filter-condition-apply'));

    expect(onApply).toHaveBeenCalledWith({
      type: 'condition',
      conditions: [{ operator: 'greaterThan', value: 100 }],
      conditionLogic: 'and',
    });
  });
});
