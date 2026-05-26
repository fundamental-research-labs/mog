/**
 * Floating Objects Projection — kernel-owned TS-side mirror of Rust's
 * floating-object state. See `./floating-objects-projection.ts` for the
 * architectural rationale.
 */

export {
  FloatingObjectsProjection,
  createFloatingObjectsProjection,
} from './floating-objects-projection';
export {
  setupFloatingObjectsProjection,
  type FloatingObjectsProjectionSetup,
  type FloatingObjectsProjectionSetupOptions,
} from './setup';
