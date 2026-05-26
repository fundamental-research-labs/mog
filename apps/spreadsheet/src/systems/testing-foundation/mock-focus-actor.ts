/**
 * Mock Focus Actor for Testing
 *
 * Creates a REAL XState actor from focusMachine (not a fake).
 * This ensures contract fidelity - the real machine handles all the state management.
 * Promoted from input/testing/ to shared testing foundation.
 *
 * @module systems/testing-foundation
 */

import { createActor } from 'xstate';

import { focusMachine } from '@mog/shell';

export function createMockFocusActor() {
  const actor = createActor(focusMachine);
  actor.start();
  return actor;
}
