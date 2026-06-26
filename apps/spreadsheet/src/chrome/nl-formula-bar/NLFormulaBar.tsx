import { memo, type ReactNode } from 'react';

interface NLFormulaBarProps {
  formulaPreview: string | null;
  loading: boolean;
  result: string | null;
  error: string | null;
  checking?: boolean;
}

function NLFormulaStatus({ children }: { children: ReactNode }) {
  return <span className="text-xs text-ss-text-secondary flex-1 min-w-0 truncate">{children}</span>;
}

function NLFormulaLoading() {
  return (
    <span className="flex-1 min-w-0 flex items-center" aria-live="polite">
      <span
        className="h-3 w-3 rounded-full border border-ss-border border-t-ss-primary animate-spin"
        aria-hidden="true"
        data-testid="nl-formula-loading"
      />
      <span className="sr-only">Explaining formula</span>
    </span>
  );
}

function NLFormulaBarImpl({
  formulaPreview,
  loading,
  result,
  error,
  checking = false,
}: NLFormulaBarProps) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 bg-ss-surface-secondary text-ss-text text-sm min-h-[32px]"
      data-testid="nl-formula-bar-content"
    >
      <div className="flex items-center gap-1 text-[#21a366] shrink-0">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" fill="currentColor" />
          <path
            d="M12 9l.75 1.75L14.5 11.5l-1.75.75L12 14l-.75-1.75L9.5 11.5l1.75-.75L12 9z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>
      </div>

      {loading ? (
        <NLFormulaLoading />
      ) : error ? (
        <span className="text-ss-error text-xs flex-1 min-w-0 truncate">{error}</span>
      ) : result != null ? (
        <span
          className="text-xs text-ss-text-secondary flex-1 min-w-0 truncate"
          data-testid="nl-explain-result"
        >
          {result}
        </span>
      ) : checking ? (
        <NLFormulaStatus>
          <span className="italic" data-testid="nl-formula-placeholder">
            Select a cell with a formula to get an explanation.
          </span>
        </NLFormulaStatus>
      ) : formulaPreview ? (
        <code
          className="text-xs font-mono text-ss-text flex-1 min-w-0 truncate"
          data-testid="nl-formula-target"
        >
          {formulaPreview}
        </code>
      ) : (
        <NLFormulaStatus>
          <span className="italic" data-testid="nl-formula-placeholder">
            Select a cell with a formula to get an explanation.
          </span>
        </NLFormulaStatus>
      )}
    </div>
  );
}

export const NLFormulaBar = memo(NLFormulaBarImpl);
