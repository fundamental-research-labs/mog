import { Component, type ReactNode } from 'react';

import type { SpreadsheetAppError } from './public-types';
import { toPublicError } from './public-error';

export { SpreadsheetAppPublicError, toPublicError } from './public-error';

type ErrorBoundaryState = {
  readonly error: Error | null;
};

export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    onError?: (error: SpreadsheetAppError) => void;
  },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(toPublicError(error, 'RuntimeError', true));
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mog-spreadsheet-app-error">
          Spreadsheet app failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
