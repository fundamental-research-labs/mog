import type { EventStore } from '../event-store';
import type { ActorEvent, MachineSnapshot } from '../types';

const MAX_TRANSITIONS_PER_MACHINE = 50;

export class ActorRecorder {
  /** Live machine snapshots, keyed by actorId */
  readonly machines = new Map<string, MachineSnapshot>();

  constructor(private store: EventStore) {}

  /** Called by the global hook when an XState inspection event fires */
  record(actorId: string, inspectionEvent: unknown): void {
    const evt = inspectionEvent as Record<string, unknown>;
    const inspType = evt.type as string;

    if (inspType === '@xstate.snapshot') {
      this.handleSnapshot(actorId, evt);
    } else if (inspType === '@xstate.event') {
      this.handleEvent(actorId, evt);
    } else if (inspType === '@xstate.actor') {
      this.handleActorRegistration(actorId, evt);
    }
  }

  private getOrCreateMachine(actorId: string): MachineSnapshot {
    let machine = this.machines.get(actorId);
    if (!machine) {
      machine = {
        actorId,
        currentState: '(unknown)',
        eventCount: 0,
        lastTransitionAt: Date.now(),
        transitions: [],
      };
      this.machines.set(actorId, machine);
    }
    return machine;
  }

  /**
   * Flow schema v2 (O-1): every actor event is emitted by the runtime in
   * response to other inputs. We tag it `source: 'internal'`, anchored to
   * the per-step clock from {@link EventStore.stepStartT}.
   */
  private tSinceStepStart(): number {
    if (typeof performance === 'undefined') return 0;
    return Math.max(0, performance.now() - this.store.stepStartT);
  }

  private handleSnapshot(actorId: string, evt: Record<string, unknown>): void {
    const machine = this.getOrCreateMachine(actorId);
    const snapshot = evt.snapshot as Record<string, unknown> | undefined;

    if (snapshot) {
      const newState = this.extractStateName(snapshot.value);
      const prevState = machine.currentState;

      // Record transition if state changed
      if (newState !== prevState) {
        const actorEvent: ActorEvent = {
          type: 'actor',
          timestamp: Date.now(),
          actorId,
          kind: 'transition',
          fromState: prevState,
          toState: newState,
          eventType: this.extractEventType(evt.event),
          source: 'internal',
          tSinceStepStart: this.tSinceStepStart(),
        };

        this.store.push(actorEvent);
        machine.transitions.push(actorEvent);

        // Trim transitions buffer
        if (machine.transitions.length > MAX_TRANSITIONS_PER_MACHINE) {
          machine.transitions = machine.transitions.slice(-MAX_TRANSITIONS_PER_MACHINE);
        }

        machine.lastTransitionAt = Date.now();
      }

      machine.currentState = newState;
      // Store context so getMachineStates() can serialize it. The raw context
      // may contain non-serializable values (functions, circular refs, Sets) —
      // getMachineStates() uses a safe JSON replacer to handle these.
      machine.context = snapshot.context;
    }
  }

  /**
   * Reset per-step recording state (transitions/events) while preserving the
   * last-known machine state. Called by `dt.clear()` at the start of each
   * test step so machine states remain visible in snapshots even when a
   * machine doesn't transition during a step.
   */
  resetStep(): void {
    for (const machine of this.machines.values()) {
      machine.transitions = [];
      machine.eventCount = 0;
    }
  }

  private handleEvent(actorId: string, evt: Record<string, unknown>): void {
    const machine = this.getOrCreateMachine(actorId);
    machine.eventCount++;

    const eventType = this.extractEventType(evt.event);

    const actorEvent: ActorEvent = {
      type: 'actor',
      timestamp: Date.now(),
      actorId,
      kind: 'event.received',
      eventType,
      source: 'internal',
      tSinceStepStart: this.tSinceStepStart(),
      // Don't store raw event data — it may contain circular references (actor refs, context)
    };

    this.store.push(actorEvent);
  }

  private handleActorRegistration(actorId: string, _evt: Record<string, unknown>): void {
    this.getOrCreateMachine(actorId);
  }

  private extractStateName(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      // XState compound states: { parent: 'child' }
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}.${v}`)
        .join(', ');
    }
    return '(unknown)';
  }

  private extractEventType(event: unknown): string {
    if (!event) return '(none)';
    if (typeof event === 'string') return event;
    if (typeof event === 'object' && event !== null && 'type' in event) {
      return (event as Record<string, unknown>).type as string;
    }
    return '(unknown)';
  }

  /** Create the inspect callback function to pass to XState createActor() */
  createInspectCallback(): (inspectionEvent: unknown) => void {
    return (inspectionEvent: unknown) => {
      const evt = inspectionEvent as Record<string, unknown>;
      // XState inspect events include actorRef
      const actorRef = evt.actorRef as { id?: string } | undefined;
      const actorId = actorRef?.id ?? '(anonymous)';
      this.record(actorId, inspectionEvent);
    };
  }
}
