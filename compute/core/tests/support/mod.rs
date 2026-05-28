//! Shared test-support scaffolding for the iterative-recalc unit-test
//! suite (Stage 1 of
//! iterative recalc integration tests).
//!
//! Later stages will extend the axes declared in [`matrix`] and layer more
//! topologies on [`fixtures`]; Stage 1 only commits the skeleton that
//! Classes I, II, III, V can build on top of.
//!
//! **Usage pattern** — every test file that needs these helpers does:
//!
//! ```ignore
//! #[path = "support/mod.rs"]
//! mod support;
//! use support::fixtures;
//! ```
//!
//! or (when the test file has its own inner module tree) `mod support;`
//! plus a file `support/mod.rs` adjacent to `tests/`. Cargo's integration
//! test harness makes each top-level `tests/*.rs` its own crate; we keep
//! the helpers as `pub` so multiple files can share them without
//! duplication.

#![allow(dead_code)] // Later stages will fill in; Stage 1 only seeds the scaffold.

pub mod assertions;
pub mod fixtures;
pub mod iterative_identity;
pub mod matrix;
pub mod recalc_fixtures;
