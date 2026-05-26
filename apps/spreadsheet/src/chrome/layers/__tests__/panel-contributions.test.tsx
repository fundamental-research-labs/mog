import React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  registerSpreadsheetPanelContribution,
  useSpreadsheetPanelContributions,
  type SpreadsheetPanelContribution,
} from '../panel-contributions';

const PREFIX = 'panel-contribution-test.';

function ContributionProbe(): React.JSX.Element {
  const contributions = useSpreadsheetPanelContributions().filter((contribution) =>
    contribution.id.startsWith(PREFIX),
  );

  return (
    <div>
      <div data-testid="ids">{contributions.map((contribution) => contribution.id).join(',')}</div>
      {contributions.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </div>
  );
}

function componentWithText(text: string): React.ComponentType {
  function TestContribution(): React.JSX.Element {
    return <span>{text}</span>;
  }

  return TestContribution;
}

describe('spreadsheet panel contribution registry', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    act(() => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    });
  });

  function register(contribution: Omit<SpreadsheetPanelContribution, 'id'> & { id: string }) {
    const dispose = registerSpreadsheetPanelContribution(contribution);
    disposers.push(dispose);
    return dispose;
  }

  it('orders contributions by order and then id', () => {
    register({ id: `${PREFIX}beta`, order: 10, Component: componentWithText('beta') });
    register({ id: `${PREFIX}alpha`, order: 10, Component: componentWithText('alpha') });
    register({ id: `${PREFIX}first`, order: -1, Component: componentWithText('first') });

    render(<ContributionProbe />);

    expect(screen.getByTestId('ids')).toHaveTextContent(
      `${PREFIX}first,${PREFIX}alpha,${PREFIX}beta`,
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('notifies subscribers when contributions register and unregister', () => {
    const firstDispose = register({
      id: `${PREFIX}live`,
      Component: componentWithText('live contribution'),
    });

    render(<ContributionProbe />);

    expect(screen.getByText('live contribution')).toBeInTheDocument();

    act(() => {
      firstDispose();
    });

    expect(screen.queryByText('live contribution')).not.toBeInTheDocument();
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });

  it('keeps a replacement registered when the previous disposer runs', () => {
    const oldDispose = register({
      id: `${PREFIX}replaceable`,
      Component: componentWithText('old contribution'),
    });
    register({
      id: `${PREFIX}replaceable`,
      Component: componentWithText('new contribution'),
    });

    render(<ContributionProbe />);

    expect(screen.queryByText('old contribution')).not.toBeInTheDocument();
    expect(screen.getByText('new contribution')).toBeInTheDocument();

    act(() => {
      oldDispose();
    });

    expect(screen.getByText('new contribution')).toBeInTheDocument();
    expect(screen.getByTestId('ids')).toHaveTextContent(`${PREFIX}replaceable`);
  });
});
