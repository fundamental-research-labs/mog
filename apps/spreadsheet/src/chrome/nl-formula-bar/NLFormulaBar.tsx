import { memo, useEffect, useRef } from 'react';
import { RibbonVisibilityPathItem } from '../toolbar/visibility/RibbonVisibilityContext';

interface NLFormulaBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onAccept: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  loading: boolean;
  result: { formula: string; explanation: string } | null;
  error: string | null;
  activeFormula: string | null;
  onExplain: () => void;
  explainLoading: boolean;
  explainResult: string | null;
  explainError: string | null;
  onExplainDismiss: () => void;
}

function ShimmerOverlay({ label = 'Generating...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 relative overflow-hidden">
      {/* Shimmer bar */}
      <div
        className="flex-1 h-5 rounded relative overflow-hidden"
        style={{ background: 'var(--ss-surface-hover, rgba(128,128,128,0.1))' }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--color-ss-primary) 50%, transparent 100%)',
            opacity: 0.15,
            animation: 'nl-shimmer 1.5s ease-in-out infinite',
          }}
        />
        {/* Sparkle dots */}
        <div
          className="absolute top-1 left-[20%] w-1 h-1 rounded-full"
          style={{
            background: 'var(--color-ss-primary)',
            opacity: 0.6,
            animation: 'nl-sparkle 1.5s ease-in-out infinite',
          }}
        />
        <div
          className="absolute top-2 left-[55%] w-1 h-1 rounded-full"
          style={{
            background: 'var(--color-ss-primary)',
            opacity: 0.4,
            animation: 'nl-sparkle 1.5s ease-in-out infinite 0.5s',
          }}
        />
        <div
          className="absolute top-1 left-[80%] w-0.5 h-0.5 rounded-full"
          style={{
            background: 'var(--color-ss-primary)',
            opacity: 0.5,
            animation: 'nl-sparkle 1.5s ease-in-out infinite 1s',
          }}
        />
      </div>
      <span className="text-xs text-ss-text-secondary shrink-0 animate-pulse">{label}</span>
      {/* Inline keyframes */}
      <style>{`
 @keyframes nl-shimmer {
 0% { transform: translateX(-100%); }
 100% { transform: translateX(100%); }
 }
 @keyframes nl-sparkle {
 0%, 100% { opacity: 0; transform: scale(0.5); }
 50% { opacity: 0.8; transform: scale(1.2); }
 }
 `}</style>
    </div>
  );
}

function NLFormulaBarImpl({
  prompt,
  onPromptChange,
  onSubmit,
  onAccept,
  onRetry,
  onDismiss,
  loading,
  result,
  error,
  activeFormula,
  onExplain,
  explainLoading,
  explainResult,
  explainError,
  onExplainDismiss,
}: NLFormulaBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the NL bar mounts (user clicked the AI icon)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Determine which mode we're in — explain states take precedence when active
  const isExplainMode = explainLoading || explainResult != null || explainError != null;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 bg-ss-surface text-ss-text text-sm min-h-[32px]"
      data-testid="nl-formula-bar-content"
    >
      {/* AI icon label */}
      <div className="flex items-center gap-1 text-ss-text-secondary shrink-0">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-ss-primary">
          <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" fill="currentColor" />
          <path
            d="M12 9l.75 1.75L14.5 11.5l-1.75.75L12 14l-.75-1.75L9.5 11.5l1.75-.75L12 9z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>
        <span className="text-xs font-medium">AI</span>
      </div>

      {/* Explain mode states */}
      {isExplainMode ? (
        explainLoading && !explainResult && !explainError ? (
          <ShimmerOverlay label="Explaining..." />
        ) : explainError ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-ss-error text-xs flex-1 min-w-0 truncate">{explainError}</span>
            <RibbonVisibilityPathItem path={['nlFormulaBar', 'explain', 'retry']}>
              <button
                onClick={onExplain}
                className="shrink-0 px-2 py-0.5 rounded text-xs font-medium border border-ss-border hover:bg-ss-surface-hover transition-colors"
                data-testid="nl-explain-retry"
              >
                Retry
              </button>
            </RibbonVisibilityPathItem>
            <RibbonVisibilityPathItem path={['nlFormulaBar', 'explain', 'dismiss']}>
              <button
                onClick={onExplainDismiss}
                className="shrink-0 px-2 py-0.5 rounded text-xs text-ss-text-secondary hover:text-ss-text transition-colors"
              >
                Dismiss
              </button>
            </RibbonVisibilityPathItem>
          </div>
        ) : explainResult != null ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className="text-xs text-ss-text-secondary flex-1 min-w-0"
              data-testid="nl-explain-result"
            >
              {explainResult}
            </span>
            <RibbonVisibilityPathItem path={['nlFormulaBar', 'explain', 'dismiss']}>
              <button
                onClick={onExplainDismiss}
                className="shrink-0 px-2 py-0.5 rounded text-xs font-medium border border-ss-border hover:bg-ss-surface-hover transition-colors"
                data-testid="nl-explain-dismiss"
              >
                Dismiss
              </button>
            </RibbonVisibilityPathItem>
          </div>
        ) : null
      ) : /* Generate mode states */
      !result && !error ? (
        <form
          className="flex items-center gap-2 flex-1 min-w-0"
          aria-busy={loading}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Describe the formula you need..."
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-ss-text placeholder:text-ss-text-tertiary text-xs"
            disabled={loading}
            data-testid="nl-formula-input"
          />
          {loading && (
            <div
              className="w-20 h-5 rounded relative overflow-hidden shrink-0"
              style={{ background: 'var(--ss-surface-hover, rgba(128,128,128,0.1))' }}
              data-testid="nl-formula-loading"
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, var(--color-ss-primary) 50%, transparent 100%)',
                  opacity: 0.15,
                  animation: 'nl-shimmer 1.5s ease-in-out infinite',
                }}
              />
              <style>{`
 @keyframes nl-shimmer {
 0% { transform: translateX(-100%); }
 100% { transform: translateX(100%); }
 }
 `}</style>
            </div>
          )}
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'generate', 'generate']}>
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="shrink-0 px-3 py-0.5 rounded text-xs font-medium bg-ss-primary text-ss-text-inverse disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ss-primary-hover transition-colors"
              data-testid="nl-formula-generate"
            >
              {loading ? 'Generating...' : 'Generate ↵'}
            </button>
          </RibbonVisibilityPathItem>
          {activeFormula && (
            <RibbonVisibilityPathItem path={['nlFormulaBar', 'generate', 'explain']}>
              <button
                type="button"
                onClick={onExplain}
                className="shrink-0 px-3 py-0.5 rounded text-xs font-medium border border-ss-border hover:bg-ss-surface-hover transition-colors"
                data-testid="nl-formula-explain"
              >
                Explain
              </button>
            </RibbonVisibilityPathItem>
          )}
        </form>
      ) : error ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-ss-error text-xs flex-1 min-w-0 truncate">{error}</span>
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'result', 'retry']}>
            <button
              onClick={onRetry}
              className="shrink-0 px-2 py-0.5 rounded text-xs font-medium border border-ss-border hover:bg-ss-surface-hover transition-colors"
              data-testid="nl-formula-retry"
            >
              Retry
            </button>
          </RibbonVisibilityPathItem>
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'result', 'dismiss']}>
            <button
              onClick={onDismiss}
              className="shrink-0 px-2 py-0.5 rounded text-xs text-ss-text-secondary hover:text-ss-text transition-colors"
            >
              Dismiss
            </button>
          </RibbonVisibilityPathItem>
        </div>
      ) : result ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <code
              className="text-xs font-mono text-ss-text block truncate"
              data-testid="nl-formula-result"
            >
              {result.formula}
            </code>
            <span className="text-xs text-ss-text-secondary block truncate">
              {result.explanation}
            </span>
          </div>
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'result', 'accept']}>
            <button
              onClick={onAccept}
              className="shrink-0 px-3 py-0.5 rounded text-xs font-medium bg-ss-primary text-ss-text-inverse hover:bg-ss-primary-hover transition-colors"
              data-testid="nl-formula-accept"
            >
              Accept
            </button>
          </RibbonVisibilityPathItem>
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'result', 'retry']}>
            <button
              onClick={onRetry}
              className="shrink-0 px-2 py-0.5 rounded text-xs font-medium border border-ss-border hover:bg-ss-surface-hover transition-colors"
              data-testid="nl-formula-retry"
            >
              Retry
            </button>
          </RibbonVisibilityPathItem>
          <RibbonVisibilityPathItem path={['nlFormulaBar', 'result', 'dismiss']}>
            <button
              onClick={onDismiss}
              className="shrink-0 px-2 py-0.5 rounded text-xs text-ss-text-secondary hover:text-ss-text transition-colors"
            >
              Dismiss
            </button>
          </RibbonVisibilityPathItem>
        </div>
      ) : null}
    </div>
  );
}

export const NLFormulaBar = memo(NLFormulaBarImpl);
