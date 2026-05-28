import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

jest.unstable_mockModule('@mog/shell', () => ({
  Icon: () => null,
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function MockInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
}));

const { Tab } = await import('../Tab');

const defaultProps = {
  id: 'sheet2',
  name: 'Sheet2',
  isActive: true,
  index: 1,
  onSelect: jest.fn(),
  onRename: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  onEditingEnd: jest.fn(),
  onContextMenu: jest.fn(),
  onDragStart: jest.fn(),
  onDragOver: jest.fn(),
  onDrop: jest.fn(),
};

function renderTab(props: Partial<React.ComponentProps<typeof Tab>> = {}) {
  const mergedProps = {
    ...defaultProps,
    onSelect: jest.fn(),
    onRename: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    onEditingEnd: jest.fn(),
    onContextMenu: jest.fn(),
    onDragStart: jest.fn(),
    onDragOver: jest.fn(),
    onDrop: jest.fn(),
    ...props,
  };

  render(<Tab {...mergedProps} />);

  return mergedProps;
}

describe('Tab inline rename', () => {
  it.each([
    'Bad\\Name',
    'Bad/Name',
    'Bad?Name',
    'Bad*Name',
    'Bad[Name',
    'Bad]Name',
    'Bad:Name',
    '12345678901234567890123456789012',
  ])('rejects statically invalid sheet name "%s" before calling onRename', async (invalidName) => {
    const props = renderTab();

    fireEvent.doubleClick(screen.getByRole('tab'));
    const input = screen.getByLabelText('Sheet name');

    fireEvent.change(input, { target: { value: invalidName } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Sheet name')).not.toBeInTheDocument();
    });

    expect(props.onRename).not.toHaveBeenCalled();
    expect(props.onEditingEnd).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sheet2')).toBeInTheDocument();
  });

  it('keeps editing open when a statically valid rename fails asynchronously', async () => {
    const onRename = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const props = renderTab({ onRename });

    fireEvent.doubleClick(screen.getByRole('tab'));
    const input = screen.getByLabelText('Sheet name');

    fireEvent.change(input, { target: { value: 'Sheet1' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('Sheet1');
    });

    expect(screen.getByLabelText('Sheet name')).toBeInTheDocument();
    expect(props.onEditingEnd).not.toHaveBeenCalled();
  });
});
