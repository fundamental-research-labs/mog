import { render, screen } from '@testing-library/react';

import { FormulaHighlighter } from './FormulaHighlighter';

describe('FormulaHighlighter', () => {
  it('lets base-level parentheses inherit the active editor text color', () => {
    render(<FormulaHighlighter formula="=SUM(A1)" />);

    expect(screen.getByText('(')).toHaveStyle({
      color: 'var(--formula-paren-0, inherit)',
    });
  });
});
