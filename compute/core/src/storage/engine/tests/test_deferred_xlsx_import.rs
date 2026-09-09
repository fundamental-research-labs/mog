//! Regression coverage for the XLSX deferred-open production path.

use super::super::*;
use super::helpers::*;

mod bootstrap_rendering;
mod calc_completion;
mod formula_visibility;
mod identity_allocation;
mod native_completion;
mod partial_export;
mod range_streaming;
mod structural_shared_formulas;
mod support;
mod table_slicers;
