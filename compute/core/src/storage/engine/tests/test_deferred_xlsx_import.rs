//! Regression coverage for the XLSX deferred-open production path.

use super::super::*;
use super::helpers::*;

mod bootstrap_rendering;
mod calc_completion;
mod formula_visibility;
mod identity_allocation;
mod partial_export;
mod provider_replay;
mod range_streaming;
mod support;
