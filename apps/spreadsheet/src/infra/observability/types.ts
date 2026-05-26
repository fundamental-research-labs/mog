/**
 * Observable Coordinator Types
 *
 * Narrow interfaces for observability tools to avoid importing
 * the full SheetCoordinator type from coordinator/.
 * TypeScript structural typing means SheetCoordinator satisfies these implicitly.
 */

import type { AnyActorRef } from 'xstate';

/**
 * Narrow interface for what the XState inspector needs from the coordinator.
 * Avoids importing the full SheetCoordinator type (DAG violation: infra/ → coordinator/).
 *
 * SheetCoordinator satisfies this interface via structural typing — no explicit
 * `implements` needed.
 */
export interface InspectableCoordinator {
  readonly grid: {
    readonly access: {
      readonly actors: Record<string, AnyActorRef>;
    };
  };
  readonly renderer: {
    readonly access: {
      readonly actors: Record<string, AnyActorRef>;
    };
  };
}
