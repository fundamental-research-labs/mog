import { isDev, isTest } from '@mog/env';

export type FilterReadinessErrorSource = 'headerCache' | 'filterActions' | 'dataTabClear';

export interface FilterReadinessErrorInput {
  source: FilterReadinessErrorSource;
  sheetId: string;
  operation: string;
  error: unknown;
}

interface FilterReadinessErrorEntry {
  kind: 'filterReadinessError';
  source: FilterReadinessErrorSource;
  sheetId: string;
  operation: string;
  message: string;
  stack?: string;
  timestamp: number;
}

declare global {
  interface Window {
    __MOG_EVAL_ERRORS?: unknown[];
  }
}

const recordedKeys = new Set<string>();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export function recordFilterReadinessError(input: FilterReadinessErrorInput): void {
  const message = errorMessage(input.error);
  const key = `${input.source}\u0000${input.sheetId}\u0000${input.operation}\u0000${message}`;
  if (recordedKeys.has(key)) return;
  recordedKeys.add(key);

  const entry: FilterReadinessErrorEntry = {
    kind: 'filterReadinessError',
    source: input.source,
    sheetId: input.sheetId,
    operation: input.operation,
    message,
    timestamp: Date.now(),
  };
  const stack = errorStack(input.error);
  if (stack) entry.stack = stack;

  console.error('[Mog filter readiness]', entry);

  if (typeof window !== 'undefined' && (isDev() || isTest())) {
    const sink = Array.isArray(window.__MOG_EVAL_ERRORS) ? window.__MOG_EVAL_ERRORS : [];
    sink.push(entry);
    window.__MOG_EVAL_ERRORS = sink;
  }
}
