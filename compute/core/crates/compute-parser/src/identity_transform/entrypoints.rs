use formula_types::{IdentityFormula, IdentityFormulaRef};

use crate::IdentityResolver;
use crate::ast::ASTNode;
use crate::parser::{ParseError, parse_formula};

use super::external::ExternalLinkBinder;
use super::flags::{check_ast_flags, top_level_is_aggregate};
use super::template::ast_to_template;

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
/// to destination-scoped [`formula_types::LinkId`]s when a binder is supplied.
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
pub(super) struct IdentityOptions {
    pub(super) prefer_rect_ranges: bool,
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
