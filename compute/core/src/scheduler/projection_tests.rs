//! Tests for spill propagation.
//!
//! These modules verify projection materialization, spill stabilization,
//! `ANCHORARRAY`, viewport patch contracts, and CSE array behavior through
//! the scheduler APIs.

#[path = "projection_tests/helpers.rs"]
mod helpers;

#[path = "projection_tests/anchorarray.rs"]
mod anchorarray;
#[path = "projection_tests/basic_spills.rs"]
mod basic_spills;
#[path = "projection_tests/cse_arrays.rs"]
mod cse_arrays;
#[path = "projection_tests/materialization.rs"]
mod materialization;
#[path = "projection_tests/patch_contracts.rs"]
mod patch_contracts;
#[path = "projection_tests/stabilization.rs"]
mod stabilization;
