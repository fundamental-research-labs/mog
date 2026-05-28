//! Class III — Numeric repeatability.
//!
//! **Invariant.** For any numeric edit on any dependency, the post-inverse
//! value of every dependent formula is **bitwise equal** to the pre-op
//! value. No epsilon. No "close enough."
//!
//! The target bug is `qKjqZiEx` (`0.4 -> 0.7000000000000001` on revert):
//! root-cause hypothesis is a stateful intermediate cache leaking the
//! forward-op's precision into the inverse recompute. Only bit-equality
//! catches that; any epsilon-based check would pass.
//!
//! Short-circuit is acceptable: the invariant asserts observable value,
//! not codepath. If the engine proves nothing changed and skips recompute,
//! bit-equality still holds trivially. We care about output, not path.
//!
//! Default family tests and `qKjqZiEx` signature pins collect and report
//! outcomes under `-- --nocapture`; they intentionally do not add a panic
//! gate. The `audit-tests` aggregate re-runs the suite and asserts the
//! total failure count.
//!
//! Run:
//!   cargo test -p compute-core --test numeric_repeatability -- --nocapture
//!
//! (Class III section)

#[path = "support/mod.rs"]
mod support;

#[path = "numeric_repeatability/audit_total.rs"]
mod audit_total;
#[path = "numeric_repeatability/edit.rs"]
mod edit;
#[path = "numeric_repeatability/mixed_type.rs"]
mod mixed_type;
#[path = "numeric_repeatability/regressions.rs"]
mod regressions;
#[path = "numeric_repeatability/runner.rs"]
mod runner;
#[path = "numeric_repeatability/seeds.rs"]
mod seeds;
#[path = "numeric_repeatability/sequences.rs"]
mod sequences;
#[path = "numeric_repeatability/topologies.rs"]
mod topologies;
#[path = "numeric_repeatability/topology_families.rs"]
mod topology_families;
