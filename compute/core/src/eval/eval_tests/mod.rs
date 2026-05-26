//! All eval unit tests — split into thematic sub-modules.

use super::test_helpers::*;
use super::*;
use crate::eval_bridge::MirrorContext;
use cell_types::*;
use compute_parser::{AbsFlags, CellRefNode, RangeRef};
use formula_types::*;
use value_types::*;

mod advanced_arrays;
mod argument_validation;
mod array_context;
mod basics;
mod coercion;
mod dynamic_refs;
mod error_propagation;
mod function_boundaries;
mod functions;
mod let_lambda;
mod lookups;
mod range_ops;
mod subtotal;
mod sumproduct;
mod wildcard_and_coercion;
