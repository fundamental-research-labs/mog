/**
 * Trap Recovery Service
 *
 * Recovers from wasm32 traps by isolating the failing doc and replaying
 * sibling docs onto a fresh WASM instance. See
 */

export {
  TrapRecoveryCoordinator,
  createTrapRecoveryCoordinator,
  type TrapRecoveryCoordinatorOptions,
} from './trap-recovery-coordinator';
