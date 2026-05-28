//! Typed umbrella for any `refers_to`-shaped field plus narrow helper types.
//!
//! # Design
//!
//! [`ParsedExpr`] is the umbrella classifier for every "this XLSX field holds
//! some expression-like string" boundary in the inventory. [`FormulaSource`] is
//! the narrow type for fields that unconditionally hold a formula; [`SqrefList`]
//! is the narrow type for XLSX `sqref` attributes.
//!
//! # Why this lives in `compute-parser`
//!
//! Placing these types in `formula-types` is infeasible: [`ParsedExpr::classify`]
//! and [`FormulaSource::parse`] must dispatch to [`crate::parse_formula`], which
//! lives in `compute-parser`. Since `compute-parser` already depends on
//! `formula-types`, placing these types in `formula-types` would require
//! `formula-types` to depend on `compute-parser` -- a Cargo cycle.
//! Rust's orphan rule also forbids inherent `impl` blocks on a foreign type, so
//! `ParsedExpr::classify` cannot be defined downstream of the type itself.
//!
//! `compute-parser` is the next-best fit: it is one layer above `formula-types`
//! in the dep DAG, already exports `ASTNode` and every A1 entry point this
//! module uses, and is already a dependency of every consumer that needs these
//! types (Yrs construction, wire queries, scheduler, and import via
//! `compute-core`). No consumer needs to gain a new dep to reach these types.
//!
//! # Totality
//!
//! [`ParsedExpr::classify`] is **total** over UTF-8: every well-formed UTF-8
//! string maps to exactly one variant. The match order is:
//!
//! 1. empty / whitespace-only -> [`ParsedExpr::Empty`]
//! 2. `#REF!` only, possibly sheet-qualified -> [`ParsedExpr::BrokenRef`]
//! 3. A1 cell ref -> [`ParsedExpr::Cell`]
//! 4. sheet-qualified A1 cell ref -> [`ParsedExpr::Cell`]
//! 5. A1 range ref -> [`ParsedExpr::Range`]
//! 6. sqref list -> [`ParsedExpr::SqrefList`]
//! 7. literal value (number / bool / quoted string / error token) ->
//!    [`ParsedExpr::Constant`]
//! 8. anything else -> [`ParsedExpr::Formula`] (via [`FormulaSource::parse`],
//!    which tolerates parser error recovery)
//!
//! There is **no `Unparseable` escape variant**. Malformed formula input lands
//! in [`ParsedExpr::Formula`] with [`FormulaSource::ast`] carrying the parser's
//! error-recovery node; [`FormulaSource::original`] preserves the raw bytes
//! verbatim for writer fidelity.

mod broken_ref;
mod classify;
mod formula_source;
mod literal;
mod serialize;
mod sqref;
mod types;

pub use formula_source::FormulaSource;
pub use sqref::SqrefList;
pub use types::{ParsedExpr, SheetName};

#[cfg(test)]
mod tests;
