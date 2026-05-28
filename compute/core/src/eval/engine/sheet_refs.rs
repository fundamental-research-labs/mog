//! Sheet-qualified, 3-D, and unavailable external reference evaluation.

use super::evaluator::Evaluator;
use super::reference_resolution::parse_defined_name_formula;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use cell_types::SheetId;
use compute_parser::ASTNode;
use formula_types::ResolvedName;
use value_types::{CellArray, CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(super) async fn eval_sheet_ref(
        &mut self,
        sheet: SheetId,
        inner: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        if let ASTNode::Identifier(name) = inner {
            self.eval_sheet_qualified_identifier(name, sheet).await
        } else {
            self.eval_node(inner).await
        }
    }

    pub(super) async fn eval_unresolved_sheet_ref(
        &mut self,
        sheet_name: &str,
        inner: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        match self.meta.sheet_by_name(sheet_name) {
            Some(sheet_id) => {
                if let ASTNode::Identifier(name) = inner {
                    self.eval_sheet_qualified_identifier(name, sheet_id).await
                } else {
                    let resolved = Self::patch_sheet_id(inner, sheet_id);
                    self.eval_node(&resolved).await
                }
            }
            None => Ok(EvalValue::Cell(CellValue::error_with_message(
                CellError::Ref,
                format!("Sheet '{}' not found", sheet_name),
            ))),
        }
    }

    pub(super) async fn eval_three_d_ref(
        &mut self,
        start_sheet: &SheetId,
        end_sheet: &SheetId,
        inner: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        let sheets = self.meta.sheets_in_range(start_sheet, end_sheet);
        self.eval_three_d_ref_for_sheets(sheets, inner).await
    }

    pub(super) async fn eval_unresolved_three_d_ref(
        &mut self,
        start_name: &str,
        end_name: &str,
        inner: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        let start_id = self.meta.sheet_by_name(start_name);
        let end_id = self.meta.sheet_by_name(end_name);
        match (start_id, end_id) {
            (Some(start), Some(end)) => {
                let sheets = self.meta.sheets_in_range(&start, &end);
                self.eval_three_d_ref_for_sheets(sheets, inner).await
            }
            _ => Ok(EvalValue::Cell(CellValue::error_with_message(
                CellError::Ref,
                format!(
                    "3-D ref: sheet '{}' or '{}' not found",
                    start_name, end_name
                ),
            ))),
        }
    }

    pub(super) fn eval_external_ref_unavailable(&self) -> EvalValue {
        EvalValue::Cell(CellValue::Error(
            CellError::Ref,
            Some("External workbook provider not configured".into()),
        ))
    }

    async fn eval_three_d_ref_for_sheets(
        &mut self,
        sheets: Vec<SheetId>,
        inner: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        let mut values = Vec::with_capacity(sheets.len());
        for sheet_id in sheets {
            let resolved = Self::patch_sheet_id(inner, sheet_id);
            let val = self.eval_node(&resolved).await?.into_cell_value();
            values.push(val);
        }
        Ok(EvalValue::Cell(CellValue::Array(std::sync::Arc::new(
            CellArray::single_column(values),
        ))))
    }

    async fn eval_sheet_qualified_identifier(
        &mut self,
        name: &str,
        sheet: SheetId,
    ) -> Result<EvalValue, ComputeError> {
        if let Some(v) = self.get_variable(name) {
            return Ok(v.clone());
        }
        match self.meta.resolve_defined_name_for_sheet(name, sheet) {
            Some(ResolvedName::Formula { raw_expression }) => {
                match parse_defined_name_formula(&raw_expression, self.meta) {
                    Some(ast) => match self.eval_node(&ast).await {
                        Ok(val) => Ok(val),
                        Err(ComputeError::DepthLimit) => {
                            Ok(EvalValue::Cell(CellValue::Error(CellError::Ref, None)))
                        }
                        Err(e) => Err(e),
                    },
                    None => Ok(EvalValue::Cell(CellValue::Error(CellError::Name, None))),
                }
            }
            Some(resolved) => Ok(EvalValue::Cell(
                self.fetch_defined_name_value(&resolved).await,
            )),
            None => Ok(EvalValue::Cell(CellValue::Error(CellError::Name, None))),
        }
    }
}
