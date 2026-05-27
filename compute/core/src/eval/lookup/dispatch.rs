//! Lookup evaluator dispatch surface.

use cell_types::SheetId;
use compute_parser::ASTNode;
use value_types::{CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

use super::{classic_eval, index_eval, match_eval, offset_eval, xlookup_eval};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) async fn eval_index(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        index_eval::eval_index(self, args).await
    }

    pub(in crate::eval) async fn eval_index_as_area(
        &mut self,
        args: &[ASTNode],
    ) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
        index_eval::eval_index_as_area(self, args).await
    }

    pub(in crate::eval) async fn eval_match(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        match_eval::eval_match(self, args).await
    }

    pub(in crate::eval) async fn eval_xmatch(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        match_eval::eval_xmatch(self, args).await
    }

    pub(in crate::eval) async fn eval_vlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        classic_eval::eval_vlookup(self, args).await
    }

    pub(in crate::eval) async fn eval_hlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        classic_eval::eval_hlookup(self, args).await
    }

    pub(in crate::eval) async fn eval_xlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        xlookup_eval::eval_xlookup(self, args).await
    }

    pub(in crate::eval) async fn eval_offset(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        offset_eval::eval_offset(self, args).await
    }

    pub(in crate::eval) async fn eval_offset_as_area(
        &mut self,
        args: &[ASTNode],
    ) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
        offset_eval::eval_offset_as_area(self, args).await
    }
}
