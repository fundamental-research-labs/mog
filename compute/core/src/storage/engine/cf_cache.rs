//! Conversion from domain-type conditional formats to compute-cf evaluation types.
//!
//! Bridges `domain_types::cf::ConditionalFormat` -> `compute_cf::types::CFRule` by:
//! 1. Flattening the domain tagged enum into `CFRuleWire` (flat wire format)
//! 2. Reusing the existing `TryFrom<CFRuleWire> for CFRule` parsing
//!
//! This replaces the TypeScript `convertRuleToWire()` in condformat-cache.ts.

mod convert;
mod data_bar;
mod engine;
mod icon_set;
mod operators;
mod ranges;
mod rule_wire;
mod style;
mod value_refs;

pub(crate) use self::convert::convert_cf_formats_to_rules;

#[cfg(test)]
mod tests;
