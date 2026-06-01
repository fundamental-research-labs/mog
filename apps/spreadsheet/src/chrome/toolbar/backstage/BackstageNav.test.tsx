import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('../../../internal-api', () => ({
  dispatch: jest.fn(),
  useActionDependencies: () => ({}),
}));

const { BackstageNav } = await import('./BackstageNav');

describe('BackstageNav text wrapping', () => {
  it('keeps file menu navigation labels on one line as widths shrink', () => {
    render(<BackstageNav activePanel="info" onClose={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Back to spreadsheet' })).toHaveClass(
      'whitespace-nowrap',
    );
    expect(screen.getByTestId('backstage-back')).toHaveTextContent('Back to spreadsheet');
    expect(screen.getByTestId('file-menu-item-browse-files')).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('file-menu-item-save-as')).toHaveClass('whitespace-nowrap');
  });
});
