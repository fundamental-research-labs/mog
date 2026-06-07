import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Checkbox } from '../Checkbox';

describe('Checkbox', () => {
  it('uses a string label as the checkbox root aria-label', () => {
    render(<Checkbox checked={false} label="High Point" onChange={jest.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'High Point' })).toHaveAttribute(
      'aria-label',
      'High Point',
    );
  });

  it('keeps an explicit aria-label when it differs from the visible label', () => {
    render(
      <Checkbox
        checked={false}
        aria-label="Toggle high point marker"
        label="High Point"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Toggle high point marker' })).toHaveAttribute(
      'aria-label',
      'Toggle high point marker',
    );
  });
});
