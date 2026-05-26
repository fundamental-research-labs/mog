//! INDIRECT function evaluation — runtime A1-style reference resolution.

use cell_types::SheetId;
use compute_parser::ASTNode;
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    // -----------------------------------------------------------------------
    // INDIRECT
    // -----------------------------------------------------------------------

    /// Evaluate INDIRECT(ref_text, [a1]).
    ///
    /// INDIRECT takes a string like "A1", "$B$5", or "Sheet1!A1:B5" and resolves
    /// it to the cell value(s) at runtime. Only A1-style references are supported.
    /// Returns `#REF!` if the string cannot be parsed as a valid reference.
    pub(in crate::eval) async fn eval_indirect(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() || args.len() > 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate the reference text
        let ref_text_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = ref_text_val {
            return Ok(CellValue::Error(e, None));
        }
        let ref_text = match ref_text_val.coerce_to_string() {
            Ok(s) => s,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Check a1 style flag (default TRUE = A1 style)
        if args.len() > 1 && !matches!(args[1], ASTNode::Omitted) {
            let a1_val = self.eval_node_cv(&args[1]).await?;
            if let CellValue::Error(e, _) = a1_val {
                return Ok(CellValue::Error(e, None));
            }
            match a1_val.coerce_to_bool() {
                Ok(false) => {
                    // R1C1 style not supported
                    return Ok(CellValue::Error(CellError::Ref, None));
                }
                Ok(true) => {} // A1 style, continue
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        }

        // Get the current cell's sheet as the default sheet
        let current_cell = self.meta.current_cell();
        let default_sheet = self
            .meta
            .resolve_position(&current_cell)
            .map(|(s, _, _)| s)
            .unwrap_or_else(|| SheetId::from_raw(0));

        // Parse the reference string as an A1-style reference first
        let result = self
            .parse_and_resolve_indirect(&ref_text, default_sheet)
            .await?;

        // If A1 parsing failed (#REF!), try resolving as a variable (defined name)
        if matches!(&result, CellValue::Error(CellError::Ref, _))
            && let Some(resolved) = self.meta.resolve_defined_name(&ref_text)
        {
            return Ok(self.fetch_defined_name_value(&resolved).await);
        }

        Ok(result)
    }

    /// Parse an A1-style reference string and resolve it to a cell value.
    async fn parse_and_resolve_indirect(
        &self,
        ref_text: &str,
        default_sheet: SheetId,
    ) -> Result<CellValue, ComputeError> {
        let ref_text = ref_text.trim();
        if ref_text.is_empty() {
            return Ok(CellValue::error_with_message(
                CellError::Ref,
                "Empty reference in INDIRECT",
            ));
        }

        // Split on '!' for sheet reference
        let (sheet_id, cell_part) = if let Some(bang_pos) = ref_text.find('!') {
            // bang_pos from find('!') — ASCII '!' is a single UTF-8 byte, boundary-safe.
            #[allow(clippy::string_slice)]
            let sheet_name_raw = &ref_text[..bang_pos];
            #[allow(clippy::string_slice)] // bang_pos + 1 is a char boundary (ASCII '!').
            let cell_part = &ref_text[bang_pos + 1..];
            // Strip surrounding quotes from sheet name
            let sheet_name = sheet_name_raw
                .trim_start_matches('\'')
                .trim_end_matches('\'');
            match self.meta.sheet_by_name(sheet_name) {
                Some(id) => (id, cell_part),
                None => {
                    return Ok(CellValue::error_with_message(
                        CellError::Ref,
                        format!("Sheet '{}' not found in INDIRECT", sheet_name),
                    ));
                }
            }
        } else {
            (default_sheet, ref_text)
        };

        // Check if it's a range (contains ':')
        if let Some(colon_pos) = cell_part.find(':') {
            // colon_pos from find(':') — ASCII ':' is a single UTF-8 byte, boundary-safe.
            #[allow(clippy::string_slice)]
            let start_str = &cell_part[..colon_pos];
            #[allow(clippy::string_slice)] // colon_pos + 1 is a char boundary (ASCII ':').
            let end_str = &cell_part[colon_pos + 1..];
            let (start_row, start_col) = match Self::parse_a1_cell(start_str) {
                Some(rc) => rc,
                None => {
                    return Ok(CellValue::error_with_message(
                        CellError::Ref,
                        format!("Invalid reference '{}' in INDIRECT", start_str),
                    ));
                }
            };
            let (end_row, end_col) = match Self::parse_a1_cell(end_str) {
                Some(rc) => rc,
                None => {
                    return Ok(CellValue::error_with_message(
                        CellError::Ref,
                        format!("Invalid reference '{}' in INDIRECT", end_str),
                    ));
                }
            };
            let start_ref = CellRef::Positional {
                sheet: sheet_id,
                row: start_row,
                col: start_col,
            };
            let end_ref = CellRef::Positional {
                sheet: sheet_id,
                row: end_row,
                col: end_col,
            };
            match self
                .data
                .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
                .await
            {
                Ok(arr) => {
                    if arr.rows() == 1 && arr.cols() == 1 {
                        Ok(arr.get(0, 0).cloned().unwrap_or(CellValue::Null))
                    } else {
                        Ok(CellValue::Array(arr))
                    }
                }
                Err(e) => Ok(CellValue::Error(e, None)),
            }
        } else {
            // Single cell reference
            let (row, col) = match Self::parse_a1_cell(cell_part) {
                Some(rc) => rc,
                None => {
                    return Ok(CellValue::error_with_message(
                        CellError::Ref,
                        format!("Invalid reference '{}' in INDIRECT", cell_part),
                    ));
                }
            };
            let cell_ref = CellRef::Positional {
                sheet: sheet_id,
                row,
                col,
            };
            Ok(self.data.get_cell_value_by_ref(&cell_ref).await)
        }
    }

    /// Parse a single A1-style cell reference like "A1", "$B$5", "AA100".
    /// Returns (row_0based, col_0based) or None if invalid.
    fn parse_a1_cell(s: &str) -> Option<(u32, u32)> {
        // Delegates to compute_parser::parse_a1_cell; unwraps the positional
        // (row, col) tuple for the existing INDIRECT call-site contract.
        let node = compute_parser::parse_a1_cell(s.trim())?;
        match node.reference {
            CellRef::Positional { row, col, .. } => Some((row, col)),
            CellRef::Resolved(_) => None,
        }
    }
}
