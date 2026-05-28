// UTF-8 boundary invariant: direct string slicing in this module uses byte
// positions returned by searching for ASCII bracket delimiters.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::ASTNode;
use crate::lexer::{self, backtrack};
use crate::references::parse_ref_after_external_sheet;
use crate::state::ParseState;
use formula_types::ExternalWorkbookToken;

/// Parse an external workbook reference: `[N]Sheet!Ref`, `[Name]Sheet!Ref`,
/// or `[Name]DefinedName`.
pub(super) fn parse_external_ref_or_error(
    input: &mut &str,
    state: &ParseState,
) -> ModalResult<ASTNode> {
    let saved = *input;
    if !input.starts_with('[') {
        return Err(backtrack());
    }
    let Some(bracket_end) = input.find(']') else {
        *input = saved;
        return Err(backtrack());
    };
    let workbook = ExternalWorkbookToken::new(input[..=bracket_end].to_string());
    *input = &input[bracket_end + 1..];

    let sheet_name: String = if input.starts_with('\'') {
        if let Ok(name) = lexer::quoted_sheet_name.parse_next(input) {
            name
        } else {
            *input = saved;
            return Err(backtrack());
        }
    } else if let Ok(name) = lexer::unquoted_sheet_name.parse_next(input) {
        name.to_string()
    } else {
        *input = saved;
        return Err(backtrack());
    };

    if !input.starts_with('!') {
        return Ok(ASTNode::ExternalNameRef {
            workbook,
            name: sheet_name,
        });
    }
    *input = &input[1..];

    let Ok(inner) = parse_ref_after_external_sheet(input, state) else {
        *input = saved;
        return Err(backtrack());
    };

    if let Some((start_sheet, end_sheet)) = sheet_name.split_once(':') {
        Ok(ASTNode::ExternalThreeDRef {
            workbook,
            start_sheet: start_sheet.to_string(),
            end_sheet: end_sheet.to_string(),
            inner: Box::new(inner),
        })
    } else {
        Ok(ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner: Box::new(inner),
        })
    }
}
