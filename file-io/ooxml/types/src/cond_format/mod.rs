//! Conditional formatting types (ECMA-376 CT_ConditionalFormatting).
//!
//! Contains vocabulary enums and structural types for conditional formatting:
//! operators, time periods, CFVO types, data bar settings, icon sets,
//! rule types, color scales, and the CfRule/ConditionalFormatting containers.

mod data_bar;
mod enums;
mod icon_set;
mod primitives;
mod rules;

#[cfg(test)]
mod tests;

pub use data_bar::*;
pub use enums::*;
pub use icon_set::*;
pub use primitives::*;
pub use rules::*;

pub(super) use primitives::default_true;
