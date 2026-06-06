#![deny(unsafe_code)]
#![deny(clippy::all)]
#![warn(clippy::pedantic, clippy::nursery)]
#![deny(rustdoc::broken_intra_doc_links)]
// Pedantic allows — justified:
#![allow(clippy::module_name_repetitions)] // Parser types naturally repeat module name (ParseError, etc.)
#![allow(clippy::must_use_candidate)] // Critical items already have #[must_use]; blanket coverage is noise
#![allow(clippy::missing_const_for_fn)] // Too aggressive — many fns only happen to be const-eligible today
#![allow(clippy::missing_errors_doc)] // Internal crate; error semantics documented on error types themselves
#![allow(clippy::missing_panics_doc)] // Internal crate; panics are test-only or unreachable branches
#![allow(clippy::struct_excessive_bools)] // RangeRef abs flags are domain-correct as bools
#![allow(clippy::similar_names)] // Parser vars like `lhs`/`rhs`, `start`/`end` are clearer with similar names
#![allow(clippy::redundant_pub_crate)] // pub(crate) inside private modules is intentional for grep-ability
#![allow(clippy::option_if_let_else)]
// match is often clearer than map_or for multi-line branches
// Typed-boundary authorship guardrail (W10): any remaining `&str[n..]` slice must be
// accompanied by an explicit `#[allow(clippy::string_slice)]` with a one-line
// ASCII-boundary justification. See `AGENTS.md` at repo root.
#![warn(clippy::string_slice)]
//! Formula Parser — converts formula strings to Rust-native AST using winnow.
//!
//! Standalone crate: depends only on `compute-types` for foundation types.
//!
//! # Architecture
//!
//! The parser is split into focused sub-modules:
//!
//! - **ast**: AST node types (`ASTNode`, `BinOp`, `UnaryOp`)
//! - **lexer**: Low-level token parsers (numbers, strings, identifiers, etc.)
//! - **references**: Cell/range/sheet reference parsing (pure leaf)
//! - **expressions**: Expression grammar with precedence climbing
//! - **parser**: Thin entry point (`ParseError` + `parse_formula`)
//! - **normalize**: XLSX formula normalization (XML entity decoding, prefix stripping)
//! - **`structured_ref_parsing`**: Structured (table) reference parsing
//!
//! Dependency DAG (no cycles):
//! ```text
//! parser → expressions → references → structured_ref_parsing
//! ```
//!
//! # Usage
//!
//! ```
//! use compute_parser::{parse_formula, ASTNode};
//!
//! let ast = parse_formula("=SUM(A1:B10)+C1*2", None).unwrap();
//! ```

// AST node types (`ASTNode`, `BinOp`, `UnaryOp`) for parsed formula trees.
mod ast;
mod expressions;
/// Owned AST transformation via the fold pattern.
mod fold;
mod intern;
pub(crate) mod lexer;
// XLSX formula normalization — XML entity decoding and prefix stripping.
mod normalize;
// Entry point: `parse_formula` and `ParseError`.
#[allow(clippy::module_inception)]
mod parser;
mod reference_tokens;
mod references;
mod state;
// Structured (table) reference parsing.
mod structured_ref_parsing;
/// Read-only AST traversal via the visitor pattern.
mod visitor;

#[cfg(test)]
mod test_helpers;

// Shared placeholder walker + prefix emitter for A1 / R1C1 renderers.
mod display;

// IdentityFormula → A1 display string conversion.
mod a1_display;

// IdentityFormula → R1C1 display string conversion.
mod r1c1_display;

// A1 formula string → IdentityFormula conversion.
mod identity_transform;

// Public short-form A1 entry points (wrappers over parse_formula).
mod a1_entry;

// Typed umbrella + narrow types (typed formula boundary).
pub mod parsed_expr;

// Re-export public types from ast
pub use ast::{ASTNode, AbsFlags, BinOp, CellRefNode, RangeRef, Span, Spanned, UnaryOp};

// Re-export visitor and fold traits
pub use fold::AstFold;
pub use visitor::AstVisitor;

// Re-export parser entry point and error types
pub use parser::{ParseError, ParseErrorKind, parse_formula};
pub use reference_tokens::{ReferenceToken, ReferenceTokenClass, collect_reference_tokens};

// Re-export transform functions
pub use a1_display::{
    sheet_qualified_reference_flags, to_a1_string, to_a1_string_qualified,
    to_a1_string_with_forced_qualifiers,
};
pub use ast::needs_quoting;
pub use identity_transform::{
    ExternalLinkBinder, ast_to_identity, to_identity_formula,
    to_identity_formula_with_external_binder, to_identity_formula_with_rect_ranges,
};
pub use r1c1_display::{to_r1c1_string, to_r1c1_string_qualified};

// Short-form A1 entry points.
pub use a1_entry::{parse_a1_cell, parse_a1_range, parse_sqref_list, split_sheet_prefix};

// Typed umbrella + narrow types (typed formula boundary).
pub use normalize::{
    decode_xml_entities_str, normalize_formula_input, normalize_xlsx_formula,
    qualify_implicit_structured_refs,
};
pub use parsed_expr::{FormulaSource, ParsedExpr, SheetName, SqrefList};
pub use structured_ref_parsing::parse_structured_ref;

// These structured-ref helpers are implementation details exposed for use in
// downstream test code (e.g. compute-table tests). They are NOT part of the
// stable public API — prefer `parse_structured_ref` for production use.
#[cfg(any(test, feature = "test-utils"))]
pub use structured_ref_parsing::{
    find_outer_matching_bracket, is_valid_table_name, parse_bracket_content, unescape_column_name,
};

use cell_types::{CellId, ColId, RowId, SheetId};
use formula_types::CellRef;

/// Trait for resolving cell references at parse time.
///
/// When a resolver is provided, the parser can:
/// - Resolve A1 notation to `CellRef::Resolved` (if the cell exists) or `CellRef::Positional`
/// - Resolve sheet names to `SheetId`
/// - Know which sheet is "current" for unqualified references
///
/// When no resolver is provided (standalone parsing), the parser always creates
/// `CellRef::Positional` with SheetId(0) for the current sheet.
///
/// # Examples
///
/// Implement a minimal resolver that always creates positional references:
///
/// ```
/// use cell_types::SheetId;
/// use formula_types::CellRef;
/// use compute_parser::CellRefResolver;
///
/// struct MyResolver { sheet: SheetId }
///
/// impl CellRefResolver for MyResolver {
///     fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
///         CellRef::Positional { sheet: *sheet, row, col }
///     }
///     fn resolve_sheet_name(&self, _name: &str) -> Option<SheetId> { None }
///     fn current_sheet(&self) -> SheetId { self.sheet }
/// }
/// ```
pub trait CellRefResolver {
    /// Resolve a (sheet, row, col) position to a `CellRef`.
    /// Returns Resolved if the cell has a `CellId`, Positional otherwise.
    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef;

    /// Resolve a sheet name to a `SheetId`.
    /// Returns None if the sheet name is not found.
    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId>;

    /// Get the current sheet's `SheetId` (for unqualified references like A1).
    fn current_sheet(&self) -> SheetId;
}

/// Trait for resolving cell positions to identity IDs during `IdentityFormula` construction.
///
/// Unlike [`CellRefResolver`] (which uses `&self` and returns [`CellRef`]),
/// this trait may need to create new [`CellId`]s for empty cells referenced in
/// formulas. Implementations use interior mutability (`RefCell`, `DashMap`, etc.)
/// so that the trait methods take `&self`, enabling parallel identity resolution.
///
/// # Examples
///
/// Implement a minimal resolver using `Cell` for sequential ID assignment:
///
/// ```
/// use cell_types::{CellId, ColId, RowId, SheetId};
/// use compute_parser::IdentityResolver;
///
/// struct SeqResolver {
///     sheet: SheetId,
///     next_id: std::cell::Cell<u128>,
/// }
///
/// impl IdentityResolver for SeqResolver {
///     fn get_or_create_cell_id(&self, _sheet: &SheetId, _row: u32, _col: u32) -> CellId {
///         let id = self.next_id.get();
///         self.next_id.set(id + 1);
///         CellId::from_raw(id)
///     }
///     fn get_row_id(&self, _sheet: &SheetId, _row: u32) -> Option<RowId> { None }
///     fn get_col_id(&self, _sheet: &SheetId, _col: u32) -> Option<ColId> { None }
///     fn resolve_sheet_name(&self, _name: &str) -> Option<SheetId> { None }
///     fn current_sheet(&self) -> SheetId { self.sheet }
/// }
/// ```
pub trait IdentityResolver {
    /// Get or create a [`CellId`] at the given position.
    /// Creates a new [`CellId`] if the cell doesn't have one yet (empty cells).
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId;

    /// Get the [`RowId`] for a row index (always exists — `RowIds` are dense).
    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId>;

    /// Get the [`ColId`] for a column index (always exists — `ColIds` are dense).
    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId>;

    /// Resolve a sheet name to a [`SheetId`].
    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId>;

    /// Get the current sheet's [`SheetId`].
    fn current_sheet(&self) -> SheetId;
}
