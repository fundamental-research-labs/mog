import { useCallback, useRef } from 'react';

export type PivotMutationOperation = () => Promise<unknown> | null | undefined;

export function usePivotMutationQueue(): (
  pivotId: string,
  operationName: string,
  operation: PivotMutationOperation,
) => Promise<void> {
  const queuesRef = useRef<Map<string, Promise<void>>>(new Map());

  return useCallback(
    (pivotId: string, operationName: string, operation: PivotMutationOperation) => {
      const previous = queuesRef.current.get(pivotId) ?? Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(async () => {
          await operation();
        })
        .catch((error) => {
          console.warn(
            `Pivot ${operationName} failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
        });

      queuesRef.current.set(pivotId, queued);
      void queued.finally(() => {
        if (queuesRef.current.get(pivotId) === queued) {
          queuesRef.current.delete(pivotId);
        }
      });

      return queued;
    },
    [],
  );
}
