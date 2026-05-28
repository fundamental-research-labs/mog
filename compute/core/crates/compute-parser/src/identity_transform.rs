//! A1 formula string -> `IdentityFormula` conversion.
//!
//! Parses a formula string, walks the AST to collect cell/range references,
//! and builds an [`IdentityFormula`] with numbered template placeholders.

use std::fmt::Write;

use cell_types::SheetId;

/// Sentinel value meaning "current sheet" — used by the parser when no explicit
/// sheet qualifier is present (e.g. `=A1` vs `=Sheet2!A1`).
///
/// **Why `SheetId(0)`?** `CellRef::Positional.sheet` is a bare `SheetId`, not
/// `Option<SheetId>`, so we need a sentinel to distinguish "same sheet" from a
/// real cross-sheet reference. `SheetId` wraps a UUID-sourced `u128`, so zero is
/// impossible in production (UUIDs are never all-zero).
///
/// // TODO: refactor `CellRef::Positional.sheet` to `Option<SheetId>` so we can
/// // use `None` instead of a sentinel value.
const CURRENT_SHEET: SheetId = SheetId::from_raw(0);
use formula_types::{
    CellRef, ExternalA1Cell, ExternalA1Range, ExternalAbsFlags, ExternalCellRef, ExternalNameRef,
    ExternalRangeAbsFlags, ExternalRangeRef, ExternalSheetKey, ExternalWorkbookToken,
    IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef, LinkId,
    RangeType,
};

use cell_types::CellId;

use crate::IdentityResolver;
use crate::ast::{ASTNode, CellRefNode, RangeRef, Span, UnaryOp};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use crate::visitor::AstVisitor;

// ---------------------------------------------------------------------------
// Dynamic array / volatile function lists
// ---------------------------------------------------------------------------

/// Functions that produce dynamic arrays (spill ranges).
const DYNAMIC_ARRAY_FUNCTIONS: &[&str] = &[
    "SEQUENCE",
    "SORT",
    "SORTBY",
    "FILTER",
    "UNIQUE",
    "RANDARRAY",
    "MAP",
    "MAKEARRAY",
    "BYROW",
    "BYCOL",
    "SCAN",
    "ANCHORARRAY",
    "SPLIT",
];

/// Functions whose results can change between recalculations without any
/// cell dependency changing.
///
/// **Canonical source:** `compute_functions::helpers::VOLATILE_FUNCTIONS`
/// (in `compute-core/crates/compute-functions/src/helpers/mod.rs`).
///
/// This is intentionally duplicated because `compute-parser` is a low-level
/// parsing crate that must not depend on `compute-functions`. When adding or
/// removing volatile functions, update **both** lists.
const VOLATILE_FUNCTIONS: &[&str] = &[
    "NOW",
    "TODAY",
    "RAND",
    "RANDBETWEEN",
    "RANDARRAY",
    "INDIRECT",
    "OFFSET",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Convert an A1-style formula **string** to an [`IdentityFormula`].
///
/// This is the high-level entry point: it parses the formula to an AST first,
/// then walks the tree to collect cell/range references and builds an
/// [`IdentityFormula`] with numbered template placeholders `{0}`, `{1}`, etc.
///
/// Use this when you have a raw formula string. If you already have a parsed
/// [`ASTNode`] (e.g. from a prior `parse_formula` call), use [`ast_to_identity`]
/// instead to avoid re-parsing.
///
/// # Examples
///
/// ```
/// # use cell_types::{CellId, ColId, RowId, SheetId};
/// use compute_parser::{IdentityResolver, to_identity_formula};
///
/// # // Minimal resolver that assigns sequential CellIds.
/// # struct SimpleResolver { sheet: SheetId, counter: std::cell::Cell<u128> }
/// # impl SimpleResolver {
/// #     fn new() -> Self { Self { sheet: SheetId::from_raw(1), counter: std::cell::Cell::new(1) } }
/// # }
/// # impl IdentityResolver for SimpleResolver {
/// #     fn get_or_create_cell_id(&self, _: &SheetId, _: u32, _: u32) -> CellId {
/// #         let n = self.counter.get(); self.counter.set(n + 1); CellId::from_raw(n)
/// #     }
/// #     fn get_row_id(&self, _: &SheetId, _: u32) -> Option<RowId> { None }
/// #     fn get_col_id(&self, _: &SheetId, _: u32) -> Option<ColId> { None }
/// #     fn resolve_sheet_name(&self, _: &str) -> Option<SheetId> { None }
/// #     fn current_sheet(&self) -> SheetId { self.sheet }
/// # }
/// let resolver = SimpleResolver::new();
/// let formula = to_identity_formula("=A1+B1", &resolver).unwrap();
/// assert_eq!(formula.template, "{0}+{1}");
/// assert_eq!(formula.refs.len(), 2);
/// ```
///
/// # Errors
///
/// Returns [`ParseError`] if the formula cannot be parsed or contains
/// unresolvable sheet references.
pub fn to_identity_formula(
    input: &str,
    resolver: &dyn IdentityResolver,
) -> Result<IdentityFormula, ParseError> {
    to_identity_formula_with_external_binder_and_options(
        input,
        resolver,
        None,
        IdentityOptions::default(),
    )
}

/// Convert a formula string to identity form, binding external workbook tokens
/// to destination-scoped [`LinkId`]s when a binder is supplied.
///
/// # Errors
///
/// Returns [`ParseError`] if parsing fails or if the formula contains an
/// external reference and no binder is supplied.
pub fn to_identity_formula_with_external_binder(
    input: &str,
    resolver: &dyn IdentityResolver,
    external_binder: Option<&dyn ExternalLinkBinder>,
) -> Result<IdentityFormula, ParseError> {
    to_identity_formula_with_external_binder_and_options(
        input,
        resolver,
        external_binder,
        IdentityOptions::default(),
    )
}

pub fn to_identity_formula_with_rect_ranges(
    input: &str,
    resolver: &dyn IdentityResolver,
) -> Result<IdentityFormula, ParseError> {
    to_identity_formula_with_external_binder_and_options(
        input,
        resolver,
        None,
        IdentityOptions {
            prefer_rect_ranges: true,
        },
    )
}

#[derive(Debug, Clone, Copy, Default)]
struct IdentityOptions {
    prefer_rect_ranges: bool,
}

fn to_identity_formula_with_external_binder_and_options(
    input: &str,
    resolver: &dyn IdentityResolver,
    external_binder: Option<&dyn ExternalLinkBinder>,
    options: IdentityOptions,
) -> Result<IdentityFormula, ParseError> {
    // Parse without a CellRefResolver — all refs will be CellRef::Positional.
    let ast = parse_formula(input, None)?.into_inner();

    let current_sheet = resolver.current_sheet();
    let mut refs: Vec<IdentityFormulaRef> = Vec::new();
    let mut template = String::new();

    ast_to_template(
        &ast,
        resolver,
        external_binder,
        options,
        &mut refs,
        current_sheet,
        &mut template,
    )?;

    let (is_dynamic_array, is_volatile) = check_ast_flags(&ast);
    let is_aggregate = top_level_is_aggregate(&ast);

    Ok(IdentityFormula {
        template,
        refs,
        is_dynamic_array,
        is_volatile,
        is_aggregate,
    })
}

/// Capability used by formula commit code to bind parser-preserved external
/// workbook tokens to persisted link registry ids.
pub trait ExternalLinkBinder {
    /// Bind or reuse a destination-scoped [`LinkId`] for the given token.
    ///
    /// # Errors
    ///
    /// Returns [`ParseError`] to abort formula persistence atomically when a
    /// token cannot be bound.
    fn bind_external_workbook(
        &self,
        workbook: &ExternalWorkbookToken,
    ) -> Result<LinkId, ParseError>;
}

/// Convert a **pre-parsed** [`ASTNode`] to an [`IdentityFormula`] without re-parsing.
///
/// Use this when you already have an AST from a prior [`parse_formula`] call
/// (e.g. during bulk init). The AST may contain [`CellRef::Resolved`] nodes
/// from a parse with a [`crate::CellRefResolver`]; these are handled directly without
/// needing position re-resolution.
///
/// For the convenience entry point that parses from a string, see
/// [`to_identity_formula`].
///
/// # Examples
///
/// ```
/// # use cell_types::{CellId, ColId, RowId, SheetId};
/// use compute_parser::{parse_formula, ast_to_identity, IdentityResolver};
///
/// # struct SimpleResolver { sheet: SheetId, counter: std::cell::Cell<u128> }
/// # impl SimpleResolver {
/// #     fn new() -> Self { Self { sheet: SheetId::from_raw(1), counter: std::cell::Cell::new(1) } }
/// # }
/// # impl IdentityResolver for SimpleResolver {
/// #     fn get_or_create_cell_id(&self, _: &SheetId, _: u32, _: u32) -> CellId {
/// #         let n = self.counter.get(); self.counter.set(n + 1); CellId::from_raw(n)
/// #     }
/// #     fn get_row_id(&self, _: &SheetId, _: u32) -> Option<RowId> { None }
/// #     fn get_col_id(&self, _: &SheetId, _: u32) -> Option<ColId> { None }
/// #     fn resolve_sheet_name(&self, _: &str) -> Option<SheetId> { None }
/// #     fn current_sheet(&self) -> SheetId { self.sheet }
/// # }
/// let ast = parse_formula("=C1*2", None).unwrap().into_inner();
/// let resolver = SimpleResolver::new();
/// let formula = ast_to_identity(&ast, &resolver).unwrap();
/// assert_eq!(formula.template, "{0}*2");
/// assert_eq!(formula.refs.len(), 1);
/// ```
///
/// # Errors
///
/// Returns [`ParseError`] if the AST contains unresolvable sheet references
/// or resolved refs in row/column ranges (which require positional info).
#[must_use = "the identity formula should be used"]
pub fn ast_to_identity(
    ast: &ASTNode,
    resolver: &dyn IdentityResolver,
) -> Result<IdentityFormula, ParseError> {
    let current_sheet = resolver.current_sheet();
    let mut refs: Vec<IdentityFormulaRef> = Vec::new();
    let mut template = String::new();

    ast_to_template(
        ast,
        resolver,
        None,
        IdentityOptions::default(),
        &mut refs,
        current_sheet,
        &mut template,
    )?;

    let (is_dynamic_array, is_volatile) = check_ast_flags(ast);
    let is_aggregate = top_level_is_aggregate(ast);

    Ok(IdentityFormula {
        template,
        refs,
        is_dynamic_array,
        is_volatile,
        is_aggregate,
    })
}

// ---------------------------------------------------------------------------
// AST -> template reconstruction
// ---------------------------------------------------------------------------

/// Resolve a [`CellRef`] to a [`CellId`], handling both `Positional` and `Resolved` variants.
fn resolve_cell_id(
    cell_ref: &CellRef,
    current_sheet: SheetId,
    resolver: &dyn IdentityResolver,
) -> CellId {
    match cell_ref {
        CellRef::Resolved(id) => *id,
        CellRef::Positional { sheet, row, col } => {
            let s = if *sheet == CURRENT_SHEET {
                current_sheet
            } else {
                *sheet
            };
            resolver.get_or_create_cell_id(&s, *row, *col)
        }
    }
}

/// Extract (sheet, row, col) from a [`CellRef`], using `default_sheet` when
/// the ref's sheet is `CURRENT_SHEET` (the sentinel for "no explicit sheet").
///
/// Returns an error for `CellRef::Resolved` because resolved refs do not carry
/// positional information needed by row/column ranges.
fn extract_position(
    cell_ref: &CellRef,
    default_sheet: SheetId,
) -> Result<(SheetId, u32, u32), ParseError> {
    match cell_ref {
        CellRef::Positional { sheet, row, col } => {
            let s = if *sheet == CURRENT_SHEET {
                default_sheet
            } else {
                *sheet
            };
            Ok((s, *row, *col))
        }
        CellRef::Resolved(_) => Err(ParseError::new(
            ParseErrorKind::InvalidReference,
            Span::empty(),
        )),
    }
}

/// Recursively walk the AST, emitting template text into `out` and collecting
/// identity refs into `refs`. Cell/range references are replaced with `{N}`
/// placeholders.
#[allow(clippy::too_many_lines, clippy::float_cmp)]
fn ast_to_template(
    node: &ASTNode,
    resolver: &dyn IdentityResolver,
    external_binder: Option<&dyn ExternalLinkBinder>,
    options: IdentityOptions,
    refs: &mut Vec<IdentityFormulaRef>,
    current_sheet: SheetId,
    out: &mut String,
) -> Result<(), ParseError> {
    match node {
        // ── Cell reference ──────────────────────────────────────────
        ASTNode::CellReference(CellRefNode {
            reference,
            abs_row,
            abs_col,
        }) => {
            let cell_id = resolve_cell_id(reference, current_sheet, resolver);
            let idx = refs.len();
            refs.push(IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell_id,
                row_absolute: *abs_row,
                col_absolute: *abs_col,
            }));
            let _ = write!(out, "{{{idx}}}");
            Ok(())
        }

        // ── Range reference ─────────────────────────────────────────
        ASTNode::Range(RangeRef {
            start,
            end,
            abs_start,
            abs_end,
            range_type,
        }) => {
            match range_type {
                RangeType::CellRange => {
                    let idx = refs.len();
                    if options.prefer_rect_ranges
                        && let Ok((s_sheet, s_row, s_col)) = extract_position(start, current_sheet)
                        && let Ok((e_sheet, e_row, e_col)) = extract_position(end, current_sheet)
                        && s_sheet == e_sheet
                        && let (
                            Some(start_row_id),
                            Some(start_col_id),
                            Some(end_row_id),
                            Some(end_col_id),
                        ) = (
                            resolver.get_row_id(&s_sheet, s_row),
                            resolver.get_col_id(&s_sheet, s_col),
                            resolver.get_row_id(&e_sheet, e_row),
                            resolver.get_col_id(&e_sheet, e_col),
                        )
                    {
                        refs.push(IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                            sheet_id: s_sheet,
                            start_row_id,
                            start_col_id,
                            end_row_id,
                            end_col_id,
                            start_row_absolute: abs_start.row,
                            start_col_absolute: abs_start.col,
                            end_row_absolute: abs_end.row,
                            end_col_absolute: abs_end.col,
                        }));
                    } else {
                        let start_id = resolve_cell_id(start, current_sheet, resolver);
                        let end_id = resolve_cell_id(end, current_sheet, resolver);
                        refs.push(IdentityFormulaRef::Range(IdentityRangeRef {
                            start_id,
                            end_id,
                            start_row_absolute: abs_start.row,
                            start_col_absolute: abs_start.col,
                            end_row_absolute: abs_end.row,
                            end_col_absolute: abs_end.col,
                        }));
                    }
                    let _ = write!(out, "{{{idx}}}");
                }
                RangeType::RowRange => {
                    let (s_sheet, s_row, _) = extract_position(start, current_sheet)?;
                    let (_, e_row, _) = extract_position(end, current_sheet)?;
                    let start_row_id = resolver.get_row_id(&s_sheet, s_row).ok_or_else(|| {
                        ParseError::new(
                            ParseErrorKind::InvalidRowNumber { row: s_row },
                            Span::empty(),
                        )
                    })?;
                    let end_row_id = resolver.get_row_id(&s_sheet, e_row).ok_or_else(|| {
                        ParseError::new(
                            ParseErrorKind::InvalidRowNumber { row: e_row },
                            Span::empty(),
                        )
                    })?;
                    let idx = refs.len();
                    if s_row == e_row {
                        refs.push(IdentityFormulaRef::FullRow(IdentityFullRowRef {
                            row_id: start_row_id,
                            absolute: abs_start.row,
                        }));
                    } else {
                        refs.push(IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                            start_row_id,
                            end_row_id,
                            start_absolute: abs_start.row,
                            end_absolute: abs_end.row,
                        }));
                    }
                    let _ = write!(out, "{{{idx}}}");
                }
                RangeType::ColumnRange => {
                    let (s_sheet, _, s_col) = extract_position(start, current_sheet)?;
                    let (_, _, e_col) = extract_position(end, current_sheet)?;
                    let start_col_id = resolver.get_col_id(&s_sheet, s_col).ok_or_else(|| {
                        ParseError::new(
                            ParseErrorKind::InvalidColumnNumber { col: s_col },
                            Span::empty(),
                        )
                    })?;
                    let end_col_id = resolver.get_col_id(&s_sheet, e_col).ok_or_else(|| {
                        ParseError::new(
                            ParseErrorKind::InvalidColumnNumber { col: e_col },
                            Span::empty(),
                        )
                    })?;
                    let idx = refs.len();
                    if s_col == e_col {
                        refs.push(IdentityFormulaRef::FullCol(IdentityFullColRef {
                            col_id: start_col_id,
                            absolute: abs_start.col,
                        }));
                    } else {
                        refs.push(IdentityFormulaRef::ColRange(IdentityColRangeRef {
                            start_col_id,
                            end_col_id,
                            start_absolute: abs_start.col,
                            end_absolute: abs_end.col,
                        }));
                    }
                    let _ = write!(out, "{{{idx}}}");
                }
                // RangeType is #[non_exhaustive]; future variants fall through here.
                _ => {
                    out.push_str("#UNKNOWN_RANGE");
                }
            }
            Ok(())
        }

        // ── Sheet-qualified reference (resolved) ────────────────────
        ASTNode::SheetRef { sheet, inner } => {
            // Process the inner node with the sheet's context.
            // The template does NOT include the sheet prefix — just {N}.
            ast_to_template(inner, resolver, external_binder, options, refs, *sheet, out)
        }

        // ── Sheet-qualified reference (unresolved name) ─────────────
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            if let Some(sheet_id) = resolver.resolve_sheet_name(sheet_name) {
                ast_to_template(
                    inner,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    sheet_id,
                    out,
                )
            } else {
                // Unresolvable external ref — emit as literal #REF! in the template.
                // This preserves the cell's identity formula without crashing.
                out.push_str("#REF!");
                Ok(())
            }
        }

        // ── 3-D reference (resolved) ────────────────────────────────
        // For identity-transform purposes, treat 3-D refs like a sheet-scoped
        // reference: process the inner node with the start_sheet context.
        // The template doesn't reproduce the 3-D sheet range — that's a
        // formula-evaluation concern, not an identity-tracking concern.
        ASTNode::ThreeDRef {
            start_sheet, inner, ..
        } => ast_to_template(
            inner,
            resolver,
            external_binder,
            options,
            refs,
            *start_sheet,
            out,
        ),

        // ── 3-D reference (unresolved) ──────────────────────────────
        ASTNode::UnresolvedThreeDRef {
            start_name, inner, ..
        } => {
            if let Some(sheet_id) = resolver.resolve_sheet_name(start_name) {
                ast_to_template(
                    inner,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    sheet_id,
                    out,
                )
            } else {
                out.push_str("#REF!");
                Ok(())
            }
        }

        ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner,
        } => emit_external_ref(
            workbook,
            Some(sheet_name),
            inner,
            external_binder,
            refs,
            out,
        ),

        ASTNode::ExternalThreeDRef {
            workbook,
            start_sheet,
            inner,
            ..
        } => emit_external_ref(
            workbook,
            Some(start_sheet),
            inner,
            external_binder,
            refs,
            out,
        ),

        ASTNode::ExternalNameRef { workbook, name } => {
            let binder = external_binder.ok_or_else(external_binding_error)?;
            let link_id = binder.bind_external_workbook(workbook)?;
            let idx = refs.len();
            refs.push(IdentityFormulaRef::ExternalName(ExternalNameRef {
                link_id,
                sheet: None,
                name: name.clone(),
            }));
            let _ = write!(out, "{{{idx}}}");
            Ok(())
        }

        // ── Literals ────────────────────────────────────────────────
        ASTNode::Number(n) => {
            if *n == n.floor() && n.abs() < 1e15 {
                #[allow(clippy::cast_possible_truncation)] // value is < 1e15, fits in i64
                let _ = write!(out, "{}", *n as i64);
            } else {
                let _ = write!(out, "{n}");
            }
            Ok(())
        }
        ASTNode::Text(s) => {
            out.push('"');
            for ch in s.chars() {
                if ch == '"' {
                    out.push_str("\"\"");
                } else {
                    out.push(ch);
                }
            }
            out.push('"');
            Ok(())
        }
        ASTNode::Boolean(b) => {
            out.push_str(if *b { "TRUE" } else { "FALSE" });
            Ok(())
        }
        ASTNode::Error(e) => {
            let _ = write!(out, "{e}");
            Ok(())
        }

        // ── Binary operation ────────────────────────────────────────
        ASTNode::BinaryOp { op, left, right } => {
            ast_to_template(
                left,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            let _ = write!(out, "{op}");
            ast_to_template(
                right,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            Ok(())
        }

        // ── Unary operation ─────────────────────────────────────────
        ASTNode::UnaryOp { op, operand } => match op {
            UnaryOp::Percent => {
                ast_to_template(
                    operand,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )?;
                out.push('%');
                Ok(())
            }
            UnaryOp::Plus => {
                out.push('+');
                ast_to_template(
                    operand,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )
            }
            UnaryOp::Minus => {
                out.push('-');
                ast_to_template(
                    operand,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )
            }
            UnaryOp::ImplicitIntersection => {
                out.push('@');
                ast_to_template(
                    operand,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )
            }
        },

        // ── Function call ───────────────────────────────────────────
        ASTNode::Function { name, args } => {
            out.push_str(name);
            out.push('(');
            for (i, arg) in args.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                ast_to_template(
                    arg,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )?;
            }
            out.push(')');
            Ok(())
        }

        // ── Parenthesized expression ────────────────────────────────
        ASTNode::Paren(inner) => {
            out.push('(');
            ast_to_template(
                inner,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            out.push(')');
            Ok(())
        }

        // ── Identifier (named range, LET/LAMBDA variable) ──────────
        ASTNode::Identifier(name) => {
            out.push_str(name);
            Ok(())
        }

        // ── Array literal ───────────────────────────────────────────
        ASTNode::Array { rows } => {
            out.push('{');
            for (i, row) in rows.iter().enumerate() {
                if i > 0 {
                    out.push(';');
                }
                for (j, elem) in row.iter().enumerate() {
                    if j > 0 {
                        out.push(',');
                    }
                    ast_to_template(
                        elem,
                        resolver,
                        external_binder,
                        options,
                        refs,
                        current_sheet,
                        out,
                    )?;
                }
            }
            out.push('}');
            Ok(())
        }

        // ── Structured (table) reference ────────────────────────────
        ASTNode::StructuredRef(_) => {
            // Pass through as literal text — tables have their own identity model.
            let _ = write!(out, "{node}");
            Ok(())
        }

        // ── Call expression (LAMBDA invocation) ─────────────────────
        ASTNode::CallExpression { callee, args } => {
            ast_to_template(
                callee,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            out.push('(');
            for (i, arg) in args.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                ast_to_template(
                    arg,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )?;
            }
            out.push(')');
            Ok(())
        }

        // ── Omitted argument ────────────────────────────────────────
        ASTNode::Omitted => Ok(()),

        // ── Optional LAMBDA parameter declaration ──────────────────
        ASTNode::OptionalLambdaParam(name) => {
            out.push('[');
            out.push_str(name);
            out.push(']');
            Ok(())
        }

        // ── Expression-level range operator ────────────────────────
        ASTNode::RangeOp { start, end } => {
            ast_to_template(
                start,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            out.push(':');
            ast_to_template(
                end,
                resolver,
                external_binder,
                options,
                refs,
                current_sheet,
                out,
            )?;
            Ok(())
        }

        // ── Union ──────────────────────────────────────────────────────
        ASTNode::Union { ranges } => {
            out.push('(');
            for (i, range) in ranges.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                ast_to_template(
                    range,
                    resolver,
                    external_binder,
                    options,
                    refs,
                    current_sheet,
                    out,
                )?;
            }
            out.push(')');
            Ok(())
        }
    }
}

fn external_binding_error() -> ParseError {
    ParseError::new(ParseErrorKind::InvalidReference, Span::empty())
}

fn emit_external_ref(
    workbook: &ExternalWorkbookToken,
    sheet_name: Option<&str>,
    inner: &ASTNode,
    external_binder: Option<&dyn ExternalLinkBinder>,
    refs: &mut Vec<IdentityFormulaRef>,
    out: &mut String,
) -> Result<(), ParseError> {
    let binder = external_binder.ok_or_else(external_binding_error)?;
    let link_id = binder.bind_external_workbook(workbook)?;
    let sheet = sheet_name.map(|name| ExternalSheetKey::Name {
        name: name.to_string(),
    });
    let idx = refs.len();
    let formula_ref = external_identity_ref(link_id, sheet, inner)?;
    refs.push(formula_ref);
    let _ = write!(out, "{{{idx}}}");
    Ok(())
}

fn external_identity_ref(
    link_id: LinkId,
    sheet: Option<ExternalSheetKey>,
    inner: &ASTNode,
) -> Result<IdentityFormulaRef, ParseError> {
    match inner {
        ASTNode::CellReference(cell) => {
            let cell_key = external_cell_from_ref(&cell.reference)?;
            Ok(IdentityFormulaRef::ExternalCell(ExternalCellRef {
                link_id,
                sheet: sheet.ok_or_else(external_binding_error)?,
                address: cell_key,
                abs: ExternalAbsFlags {
                    row_abs: cell.abs_row,
                    col_abs: cell.abs_col,
                },
            }))
        }
        ASTNode::Range(range) => {
            let start = external_cell_from_ref(&range.start)?;
            let end = external_cell_from_ref(&range.end)?;
            Ok(IdentityFormulaRef::ExternalRange(ExternalRangeRef {
                link_id,
                sheet: sheet.ok_or_else(external_binding_error)?,
                address: ExternalA1Range { start, end },
                abs: ExternalRangeAbsFlags {
                    start: ExternalAbsFlags {
                        row_abs: range.abs_start.row,
                        col_abs: range.abs_start.col,
                    },
                    end: ExternalAbsFlags {
                        row_abs: range.abs_end.row,
                        col_abs: range.abs_end.col,
                    },
                },
            }))
        }
        ASTNode::Identifier(name) => Ok(IdentityFormulaRef::ExternalName(ExternalNameRef {
            link_id,
            sheet,
            name: name.clone(),
        })),
        _ => Err(external_binding_error()),
    }
}

fn external_cell_from_ref(cell_ref: &CellRef) -> Result<ExternalA1Cell, ParseError> {
    match cell_ref {
        CellRef::Positional { row, col, .. } => Ok(ExternalA1Cell {
            row: row.saturating_add(1),
            col: col.saturating_add(1),
        }),
        CellRef::Resolved(_) => Err(external_binding_error()),
    }
}

// ---------------------------------------------------------------------------
// Flag detection
// ---------------------------------------------------------------------------

/// AST visitor that detects dynamic-array and volatile function calls.
struct FlagDetector {
    is_dynamic: bool,
    is_volatile: bool,
}

impl AstVisitor for FlagDetector {
    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        if DYNAMIC_ARRAY_FUNCTIONS
            .iter()
            .any(|f| f.eq_ignore_ascii_case(name))
        {
            self.is_dynamic = true;
        }
        if VOLATILE_FUNCTIONS
            .iter()
            .any(|f| f.eq_ignore_ascii_case(name))
        {
            self.is_volatile = true;
        }
        // Continue recursion into children via default walk.
        for arg in args {
            self.visit(arg);
        }
    }
}

/// Walk the AST to detect dynamic-array and volatile function calls.
fn check_ast_flags(node: &ASTNode) -> (bool, bool) {
    let mut detector = FlagDetector {
        is_dynamic: false,
        is_volatile: false,
    };
    detector.visit(node);
    (detector.is_dynamic, detector.is_volatile)
}

/// Return `true` iff the **top-level** call of `node` is `SUBTOTAL` or
/// `AGGREGATE` (matched case-insensitively on the function name, with the
/// XLSX-internal `_XLFN.` prefix tolerated).
///
/// Replaces the string-prefix shadow parser `formula_is_subtotal_or_aggregate`
/// (typed formula boundary). XLSX pipelines that call `normalize_xlsx_formula` before
/// parsing surface `_xlfn.SUBTOTAL(...)` as an `ASTNode::Function { name:
/// "SUBTOTAL", .. }`; paths that skip normalization may keep the prefix in
/// the function identifier, so we accept it here as well — matching the
/// old shadow parser's `strip_prefix("_XLFN.")` behavior.
///
/// **Top-level only**: `IF(TRUE, SUBTOTAL(1, A1:A10), 0)` returns `false`
/// because the top-level call is `IF`, matching the shadow parser's
/// `starts_with("SUBTOTAL(")` semantics. This is the behavior [`SUBTOTAL`]'s
/// skip-nested-aggregates rule relies on.
fn top_level_is_aggregate(node: &ASTNode) -> bool {
    match node {
        ASTNode::Function { name, .. } => is_aggregate_name(name),
        _ => false,
    }
}

/// Match the (possibly `_xlfn.`-prefixed) function name against the aggregate
/// whitelist. Case-insensitive in both the prefix and the function identifier.
fn is_aggregate_name(name: &str) -> bool {
    let stripped = name
        .strip_prefix("_xlfn.")
        .or_else(|| name.strip_prefix("_XLFN."))
        .or_else(|| {
            // Case-insensitive prefix strip for exotic casings (`_Xlfn.` etc.).
            // The len() >= 6 guard precedes every slice; the first 6 bytes
            // (if present) are `_xlfn.` / `_XLFN.` / `_Xlfn.` etc., all of
            // which are ASCII — char-boundary guaranteed at byte offset 6.
            if name.len() >= 6 {
                #[allow(clippy::string_slice)]
                let head = &name[..6];
                if head.eq_ignore_ascii_case("_xlfn.") {
                    #[allow(clippy::string_slice)]
                    let rest = &name[6..];
                    return Some(rest);
                }
            }
            None
        })
        .unwrap_or(name);
    stripped.eq_ignore_ascii_case("SUBTOTAL") || stripped.eq_ignore_ascii_case("AGGREGATE")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::AbsFlags;
    use cell_types::{CellId, ColId, RowId, SheetId};
    use formula_types::IdentityFormulaRef;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    /// Mock resolver for tests. Creates CellIds/RowIds/ColIds on the fly
    /// using simple deterministic counters. Uses interior mutability so that
    /// `get_or_create_cell_id(&self)` can allocate new IDs.
    struct MockResolver {
        sheet: SheetId,
        next_cell_id: Cell<u128>,
        cell_ids: RefCell<HashMap<(SheetId, u32, u32), CellId>>,
        row_ids: HashMap<(SheetId, u32), RowId>,
        col_ids: HashMap<(SheetId, u32), ColId>,
        sheets: HashMap<String, SheetId>,
    }

    impl MockResolver {
        fn new() -> Self {
            let sheet = SheetId::from_raw(1);
            let mut row_ids = HashMap::new();
            let mut col_ids = HashMap::new();
            // Pre-populate dense row/col IDs (rows 0-999, cols 0-25).
            for r in 0..1000 {
                row_ids.insert((sheet, r), RowId::from_raw(1000 + u128::from(r)));
            }
            for c in 0..26 {
                col_ids.insert((sheet, c), ColId::from_raw(2000 + u128::from(c)));
            }
            Self {
                sheet,
                next_cell_id: Cell::new(100),
                cell_ids: RefCell::new(HashMap::new()),
                row_ids,
                col_ids,
                sheets: HashMap::new(),
            }
        }

        /// Add a second sheet to the resolver for cross-sheet tests.
        fn add_sheet(&mut self, name: &str, id: u128) {
            let sheet_id = SheetId::from_raw(id);
            self.sheets.insert(name.to_string(), sheet_id);
            // Populate row/col IDs for the new sheet as well.
            for r in 0..1000 {
                self.row_ids.insert(
                    (sheet_id, r),
                    RowId::from_raw(id * 10000 + 1000 + u128::from(r)),
                );
            }
            for c in 0..26 {
                self.col_ids.insert(
                    (sheet_id, c),
                    ColId::from_raw(id * 10000 + 2000 + u128::from(c)),
                );
            }
        }
    }

    impl IdentityResolver for MockResolver {
        fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
            let mut cell_ids = self.cell_ids.borrow_mut();
            *cell_ids.entry((*sheet, row, col)).or_insert_with(|| {
                let id = CellId::from_raw(self.next_cell_id.get());
                self.next_cell_id.set(self.next_cell_id.get() + 1);
                id
            })
        }

        fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
            self.row_ids.get(&(*sheet, row)).copied()
        }

        fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
            self.col_ids.get(&(*sheet, col)).copied()
        }

        fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
            self.sheets.get(name).copied()
        }

        fn current_sheet(&self) -> SheetId {
            self.sheet
        }
    }

    // ── Basic cell reference tests ──────────────────────────────────

    #[test]
    fn simple_addition_two_cells() {
        let r = MockResolver::new();
        let f = to_identity_formula("=A1+B1", &r).unwrap();
        assert_eq!(f.template, "{0}+{1}");
        assert_eq!(f.refs.len(), 2);
        assert!(matches!(f.refs[0], IdentityFormulaRef::Cell(_)));
        assert!(matches!(f.refs[1], IdentityFormulaRef::Cell(_)));
    }

    #[test]
    fn sum_range() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        assert_eq!(f.refs.len(), 1);
        assert!(matches!(f.refs[0], IdentityFormulaRef::Range(_)));
    }

    #[test]
    fn cells_with_constant() {
        let r = MockResolver::new();
        let f = to_identity_formula("=A1+B1*2", &r).unwrap();
        assert_eq!(f.template, "{0}+{1}*2");
        assert_eq!(f.refs.len(), 2);
    }

    #[test]
    fn full_column_range() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A:A)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        assert_eq!(f.refs.len(), 1);
        assert!(matches!(f.refs[0], IdentityFormulaRef::FullCol(_)));
    }

    #[test]
    fn column_range_different_cols() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A:C)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        assert_eq!(f.refs.len(), 1);
        assert!(matches!(f.refs[0], IdentityFormulaRef::ColRange(_)));
    }

    #[test]
    fn row_range_different_rows() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(1:5)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        assert_eq!(f.refs.len(), 1);
        assert!(matches!(f.refs[0], IdentityFormulaRef::RowRange(_)));
    }

    #[test]
    fn full_row_same_row() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(1:1)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        assert_eq!(f.refs.len(), 1);
        assert!(matches!(f.refs[0], IdentityFormulaRef::FullRow(_)));
    }

    // ── Flag tests ──────────────────────────────────────────────────

    #[test]
    fn dynamic_array_sequence() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SEQUENCE(5)", &r).unwrap();
        assert!(f.is_dynamic_array);
        assert!(!f.is_volatile);
    }

    #[test]
    fn dynamic_array_split() {
        let r = MockResolver::new();
        let f = to_identity_formula(r#"=SPLIT("a,b",",")"#, &r).unwrap();
        assert!(f.is_dynamic_array);
        assert!(!f.is_volatile);
    }

    #[test]
    fn volatile_now() {
        let r = MockResolver::new();
        let f = to_identity_formula("=NOW()", &r).unwrap();
        assert!(f.is_volatile);
        assert!(!f.is_dynamic_array);
    }

    #[test]
    fn randarray_is_dynamic_and_volatile() {
        let r = MockResolver::new();
        let f = to_identity_formula("=RANDARRAY(2,3)", &r).unwrap();
        assert!(f.is_dynamic_array);
        assert!(f.is_volatile);
    }

    // ── Mixed formula tests ─────────────────────────────────────────

    #[test]
    fn sum_range_plus_cell_times_constant() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A1:B10)+C1*2", &r).unwrap();
        assert_eq!(f.template, "SUM({0})+{1}*2");
        assert_eq!(f.refs.len(), 2);
        assert!(matches!(f.refs[0], IdentityFormulaRef::Range(_)));
        assert!(matches!(f.refs[1], IdentityFormulaRef::Cell(_)));
    }

    // ── Absolute reference tests ────────────────────────────────────

    #[test]
    fn absolute_cell_ref() {
        let r = MockResolver::new();
        let f = to_identity_formula("=$A$1", &r).unwrap();
        assert_eq!(f.template, "{0}");
        assert_eq!(f.refs.len(), 1);
        match &f.refs[0] {
            IdentityFormulaRef::Cell(c) => {
                assert!(c.row_absolute);
                assert!(c.col_absolute);
            }
            _ => panic!("expected Cell ref"),
        }
    }

    // ── Pure literal tests ──────────────────────────────────────────

    #[test]
    fn boolean_literal() {
        let r = MockResolver::new();
        let f = to_identity_formula("=TRUE", &r).unwrap();
        assert_eq!(f.template, "TRUE");
        assert_eq!(f.refs.len(), 0);
    }

    #[test]
    fn numeric_literal() {
        let r = MockResolver::new();
        let f = to_identity_formula("=1+2", &r).unwrap();
        assert_eq!(f.template, "1+2");
        assert_eq!(f.refs.len(), 0);
    }

    #[test]
    fn string_literal() {
        let r = MockResolver::new();
        let f = to_identity_formula("=\"hello\"", &r).unwrap();
        assert_eq!(f.template, "\"hello\"");
        assert_eq!(f.refs.len(), 0);
    }

    // ── Non-volatile / non-dynamic formula ──────────────────────────

    #[test]
    fn regular_function_no_flags() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
        assert!(!f.is_dynamic_array);
        assert!(!f.is_volatile);
    }

    // ── Cross-sheet reference tests ─────────────────────────────────

    #[test]
    fn cross_sheet_ref() {
        let mut r = MockResolver::new();
        r.add_sheet("Sheet2", 2);
        let f = to_identity_formula("=Sheet2!A1", &r).unwrap();
        // Template should NOT include the sheet prefix.
        assert_eq!(f.template, "{0}");
        assert_eq!(f.refs.len(), 1);
    }

    #[test]
    fn unresolved_sheet_emits_ref_error() {
        let r = MockResolver::new();
        let result = to_identity_formula("=NoSuchSheet!A1", &r);
        // Unknown sheets now gracefully emit #REF! instead of returning an error
        assert!(result.is_ok());
        assert_eq!(result.unwrap().template, "#REF!");
    }

    #[test]
    fn unresolved_sheet_in_compound_expression() {
        let r = MockResolver::new();
        // =NoSuchSheet!A1+1 — the unresolvable ref becomes #REF! but +1 is preserved
        let result = to_identity_formula("=NoSuchSheet!A1+1", &r);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().template, "#REF!+1");
    }

    #[test]
    fn unresolved_sheet_in_function_arg() {
        let r = MockResolver::new();
        let result = to_identity_formula("=SUM(NoSuchSheet!A1,1)", &r);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().template, "SUM(#REF!,1)");
    }

    // ── Nested dynamic array ────────────────────────────────────────

    #[test]
    fn nested_dynamic_array_in_sum() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(SEQUENCE(5))", &r).unwrap();
        assert!(f.is_dynamic_array);
    }

    // ── Deterministic CellId assignment ─────────────────────────────

    #[test]
    fn same_cell_reused() {
        let r = MockResolver::new();
        let f = to_identity_formula("=A1+A1", &r).unwrap();
        assert_eq!(f.template, "{0}+{1}");
        // Both refs should have the same CellId since they reference
        // the same cell position.
        match (&f.refs[0], &f.refs[1]) {
            (IdentityFormulaRef::Cell(a), IdentityFormulaRef::Cell(b)) => {
                assert_eq!(a.id, b.id);
            }
            _ => panic!("expected two Cell refs"),
        }
    }

    // ── Volatile function inside expression ─────────────────────────

    #[test]
    fn volatile_in_expression() {
        let r = MockResolver::new();
        let f = to_identity_formula("=A1+RAND()", &r).unwrap();
        assert!(f.is_volatile);
        assert!(!f.is_dynamic_array);
    }

    // ── Error literal ───────────────────────────────────────────────

    #[test]
    fn error_literal_template() {
        let r = MockResolver::new();
        let f = to_identity_formula("=#N/A", &r).unwrap();
        assert_eq!(f.template, "#N/A");
        assert_eq!(f.refs.len(), 0);
    }

    // ── Paren / array / omitted ─────────────────────────────────────

    #[test]
    fn parenthesized_expression() {
        let r = MockResolver::new();
        let f = to_identity_formula("=(A1+B1)*2", &r).unwrap();
        assert_eq!(f.template, "({0}+{1})*2");
        assert_eq!(f.refs.len(), 2);
    }

    #[test]
    fn array_literal_template() {
        let r = MockResolver::new();
        let f = to_identity_formula("={1,2;3,4}", &r).unwrap();
        assert_eq!(f.template, "{1,2;3,4}");
        assert_eq!(f.refs.len(), 0);
    }

    #[test]
    fn omitted_args() {
        let r = MockResolver::new();
        let f = to_identity_formula("=IF(A1,,0)", &r).unwrap();
        assert_eq!(f.template, "IF({0},,0)");
        assert_eq!(f.refs.len(), 1);
    }

    // ── Absolute range ref ──────────────────────────────────────────

    #[test]
    fn absolute_range_ref() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM($A$1:$B$10)", &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        match &f.refs[0] {
            IdentityFormulaRef::Range(rng) => {
                assert!(rng.start_row_absolute);
                assert!(rng.start_col_absolute);
                assert!(rng.end_row_absolute);
                assert!(rng.end_col_absolute);
            }
            _ => panic!("expected Range ref"),
        }
    }

    // ── Unary operations ────────────────────────────────────────────

    #[test]
    fn unary_minus() {
        let r = MockResolver::new();
        let f = to_identity_formula("=-A1", &r).unwrap();
        assert_eq!(f.template, "-{0}");
        assert_eq!(f.refs.len(), 1);
    }

    #[test]
    fn unary_percent() {
        let r = MockResolver::new();
        let f = to_identity_formula("=50%", &r).unwrap();
        assert_eq!(f.template, "50%");
        assert_eq!(f.refs.len(), 0);
    }

    // ── ast_to_identity tests ──────────────────────────────────────

    #[test]
    fn ast_to_identity_matches_to_identity_formula() {
        // Parse without resolver (Positional refs)
        let ast = parse_formula("=A1+B1*2", None).unwrap().into_inner();
        let r = MockResolver::new();
        let from_ast = ast_to_identity(&ast, &r).unwrap();

        let r2 = MockResolver::new();
        let from_string = to_identity_formula("=A1+B1*2", &r2).unwrap();

        assert_eq!(from_ast.template, from_string.template);
        assert_eq!(from_ast.refs.len(), from_string.refs.len());
        assert_eq!(from_ast.is_dynamic_array, from_string.is_dynamic_array);
        assert_eq!(from_ast.is_volatile, from_string.is_volatile);
    }

    #[test]
    fn ast_to_identity_with_resolved_cell_ref() {
        let cell_id = CellId::from_raw(42);
        let ast = ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(cell_id),
            abs_row: false,
            abs_col: false,
        });
        let r = MockResolver::new();
        let f = ast_to_identity(&ast, &r).unwrap();
        assert_eq!(f.template, "{0}");
        match &f.refs[0] {
            IdentityFormulaRef::Cell(c) => assert_eq!(c.id, cell_id),
            _ => panic!("expected Cell ref"),
        }
    }

    #[test]
    fn ast_to_identity_with_resolved_range() {
        let start_id = CellId::from_raw(10);
        let end_id = CellId::from_raw(20);
        let ast = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Range(RangeRef {
                start: CellRef::Resolved(start_id),
                end: CellRef::Resolved(end_id),
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: RangeType::CellRange,
            })],
        };
        let r = MockResolver::new();
        let f = ast_to_identity(&ast, &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        match &f.refs[0] {
            IdentityFormulaRef::Range(rng) => {
                assert_eq!(rng.start_id, start_id);
                assert_eq!(rng.end_id, end_id);
            }
            _ => panic!("expected Range ref"),
        }
    }

    #[test]
    fn ast_to_identity_sum_range_plus_cell() {
        let ast = parse_formula("=SUM(A1:B10)+C1*2", None)
            .unwrap()
            .into_inner();
        let r = MockResolver::new();
        let from_ast = ast_to_identity(&ast, &r).unwrap();
        assert_eq!(from_ast.template, "SUM({0})+{1}*2");
        assert_eq!(from_ast.refs.len(), 2);
    }

    #[test]
    fn ast_to_identity_flags_preserved() {
        let ast = parse_formula("=SEQUENCE(5)+NOW()", None)
            .unwrap()
            .into_inner();
        let r = MockResolver::new();
        let f = ast_to_identity(&ast, &r).unwrap();
        assert!(f.is_dynamic_array);
        assert!(f.is_volatile);
    }

    // ── is_aggregate (typed formula boundary) ──────────────────────────────────

    #[test]
    fn aggregate_flag_subtotal_top_level() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUBTOTAL(1, A1:A10)", &r).unwrap();
        assert!(f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_xlfn_subtotal_top_level() {
        // `_xlfn.` is stripped by normalize before parsing, so the AST sees
        // the bare function name — still aggregate.
        let r = MockResolver::new();
        let f = to_identity_formula("=_xlfn.SUBTOTAL(1, A1:A10)", &r).unwrap();
        assert!(f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_aggregate_top_level() {
        let r = MockResolver::new();
        let f = to_identity_formula("=AGGREGATE(9, 0, A1:A10)", &r).unwrap();
        assert!(f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_subtotal_case_insensitive() {
        let r = MockResolver::new();
        let f = to_identity_formula("=subtotal(1, A1:A10)", &r).unwrap();
        assert!(f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_plain_sum_false() {
        let r = MockResolver::new();
        let f = to_identity_formula("=SUM(A1:A10)", &r).unwrap();
        assert!(!f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_nested_subtotal_false() {
        // The top-level call is IF; SUBTOTAL is nested — match the old
        // shadow parser's `starts_with("SUBTOTAL(")` semantics.
        let r = MockResolver::new();
        let f = to_identity_formula("=IF(TRUE, SUBTOTAL(1, A1:A10), 0)", &r).unwrap();
        assert!(!f.is_aggregate);
    }

    #[test]
    fn aggregate_flag_constant_false() {
        let r = MockResolver::new();
        let f = to_identity_formula("=42", &r).unwrap();
        assert!(!f.is_aggregate);
    }

    #[test]
    fn ast_to_identity_cross_sheet() {
        let mut r = MockResolver::new();
        r.add_sheet("Sheet2", 2);
        // Parse without resolver — creates UnresolvedSheetRef
        let ast = parse_formula("=Sheet2!A1+B1", None).unwrap().into_inner();
        let f = ast_to_identity(&ast, &r).unwrap();
        assert_eq!(f.template, "{0}+{1}");
        assert_eq!(f.refs.len(), 2);
    }

    #[test]
    fn ast_to_identity_with_mixed_resolved_positional_range() {
        // CellRange where start is Resolved and end is Positional
        let start_id = CellId::from_raw(50);
        let sheet = SheetId::from_raw(0); // current sheet sentinel
        let ast = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Range(RangeRef {
                start: CellRef::Resolved(start_id),
                end: CellRef::Positional {
                    sheet,
                    row: 9,
                    col: 1,
                },
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: RangeType::CellRange,
            })],
        };
        let r = MockResolver::new();
        let f = ast_to_identity(&ast, &r).unwrap();
        assert_eq!(f.template, "SUM({0})");
        match &f.refs[0] {
            IdentityFormulaRef::Range(rng) => {
                assert_eq!(rng.start_id, start_id);
                // end_id was created by the resolver
                assert_ne!(rng.end_id, start_id);
            }
            _ => panic!("expected Range ref"),
        }
    }
}
