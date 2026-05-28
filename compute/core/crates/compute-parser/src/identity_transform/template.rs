use std::fmt::Write;

use cell_types::SheetId;
use formula_types::IdentityFormulaRef;

use crate::IdentityResolver;
use crate::ast::{ASTNode, UnaryOp};
use crate::parser::ParseError;

use super::entrypoints::IdentityOptions;
use super::external::{self, ExternalLinkBinder};
use super::refs;

/// Recursively walk the AST, emitting template text into `out` and collecting
/// identity refs into `refs`. Cell/range references are replaced with `{N}`
/// placeholders.
#[allow(clippy::too_many_lines, clippy::float_cmp)]
pub(super) fn ast_to_template(
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
        ASTNode::CellReference(cell) => {
            refs::emit_cell_ref(cell, current_sheet, resolver, refs, out);
            Ok(())
        }

        // ── Range reference ─────────────────────────────────────────
        ASTNode::Range(range) => {
            refs::emit_range_ref(range, current_sheet, resolver, options, refs, out)
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
        } => external::emit_external_ref(
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
        } => external::emit_external_ref(
            workbook,
            Some(start_sheet),
            inner,
            external_binder,
            refs,
            out,
        ),

        ASTNode::ExternalNameRef { workbook, name } => {
            external::emit_external_name_ref(workbook, name, external_binder, refs, out)
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
