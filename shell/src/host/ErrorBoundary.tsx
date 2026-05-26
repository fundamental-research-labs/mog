/**
 * ErrorBoundary - React error boundary for app isolation
 *
 * Catches errors in child components and displays fallback UI.
 * Required to be a class component per React API.
 *
 */

import React from 'react';

export interface ErrorBoundaryProps {
  /** Content to render when no error */
  children: React.ReactNode;

  /** Fallback UI to render when error occurs */
  fallback: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary - Isolates app crashes from the rest of the shell
 *
 * React Error Boundary that:
 * - Catches errors in any child component
 * - Displays custom fallback UI
 * - Provides reset mechanism to retry
 *
 * Must be a class component (React requirement).
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      return fallback(error, this.reset);
    }

    return children;
  }
}
