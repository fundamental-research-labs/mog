/**
 * In-memory diagnostics sink with query and assertion helpers.
 *
 * Captures every `HostDiagnosticEvent` emitted during test host operation
 * and provides convenience methods for test assertions.
 */

import type { HostDiagnosticEvent, HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';

export interface DiagnosticsCapture {
  /** The sink to wire into host contexts. */
  readonly sink: HostDiagnosticsSink;

  /** All captured events in emission order. */
  readonly events: readonly HostDiagnosticEvent[];

  /** Returns true if at least one event with the given `kind` has been captured. */
  hasEvent(kind: string): boolean;

  /** Returns all captured events matching the given `kind`. */
  eventsOfKind(kind: string): readonly HostDiagnosticEvent[];

  /** Throws if no event with the given `kind` has been captured. */
  assertHasEvent(kind: string, message?: string): void;

  /** Throws if any event with the given `kind` has been captured. */
  assertNoEvent(kind: string, message?: string): void;

  /** Removes all captured events. */
  clear(): void;
}

export function createDiagnosticsCapture(): DiagnosticsCapture {
  const captured: HostDiagnosticEvent[] = [];

  const sink: HostDiagnosticsSink = {
    emit(event: HostDiagnosticEvent): void {
      captured.push(event);
    },
  };

  return {
    get sink() {
      return sink;
    },

    get events(): readonly HostDiagnosticEvent[] {
      return captured;
    },

    hasEvent(kind: string): boolean {
      return captured.some((e) => e.kind === kind);
    },

    eventsOfKind(kind: string): readonly HostDiagnosticEvent[] {
      return captured.filter((e) => e.kind === kind);
    },

    assertHasEvent(kind: string, message?: string): void {
      if (!captured.some((e) => e.kind === kind)) {
        throw new Error(
          message ??
            `Expected diagnostic event '${kind}' but none was captured. Got: [${captured.map((e) => e.kind).join(', ')}]`,
        );
      }
    },

    assertNoEvent(kind: string, message?: string): void {
      const found = captured.filter((e) => e.kind === kind);
      if (found.length > 0) {
        throw new Error(
          message ?? `Expected no diagnostic event '${kind}' but found ${found.length}`,
        );
      }
    },

    clear(): void {
      captured.length = 0;
    },
  };
}
