//! Reference area extraction, range operator, and reference intersections.

use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use cell_types::SheetId;
use compute_parser::{ASTNode, CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType, ResolvedName};
use value_types::{CellError, CellValue, ComputeError};

pub(in crate::eval) type RefArea = (SheetId, u32, u32, u32, u32);

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(super) async fn eval_range_op(
        &mut self,
        start: &ASTNode,
        end: &ASTNode,
    ) -> Result<EvalValue, ComputeError> {
        let area_start = match self.eval_node_as_area(start).await {
            Ok(a) => a,
            Err(ComputeError::Eval { .. }) => {
                return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
            }
            Err(e) => return Err(e),
        };
        let area_end = match self.eval_node_as_area(end).await {
            Ok(a) => a,
            Err(ComputeError::Eval { .. }) => {
                return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
            }
            Err(e) => return Err(e),
        };
        let (s1, sr1, sc1, er1, ec1) = area_start;
        let (s2, sr2, sc2, er2, ec2) = area_end;
        if s1 != s2 {
            return Ok(EvalValue::Cell(CellValue::Error(CellError::Ref, None)));
        }
        let min_row = sr1.min(sr2).min(er1).min(er2);
        let min_col = sc1.min(sc2).min(ec1).min(ec2);
        let max_row = er1.max(er2).max(sr1).max(sr2);
        let max_col = ec1.max(ec2).max(sc1).max(sc2);
        let start_ref = CellRef::Positional {
            sheet: s1,
            row: min_row,
            col: min_col,
        };
        let end_ref = CellRef::Positional {
            sheet: s1,
            row: max_row,
            col: max_col,
        };
        if min_row == max_row && min_col == max_col {
            Ok(EvalValue::Cell(
                self.data.get_cell_value_by_ref(&start_ref).await,
            ))
        } else {
            match self
                .data
                .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
                .await
            {
                Ok(arr) => Ok(EvalValue::Cell(CellValue::Array(arr))),
                Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
            }
        }
    }

    pub(super) async fn eval_reference_intersection(
        &mut self,
        left: &ASTNode,
        right: &ASTNode,
    ) -> Result<CellValue, ComputeError> {
        let left_area = match self.eval_node_as_intersection_area(left).await {
            Ok(Some(area)) => area,
            Ok(None) => return Ok(CellValue::Error(CellError::Null, None)),
            Err(ComputeError::Eval { .. }) => return Ok(CellValue::Error(CellError::Value, None)),
            Err(e) => return Err(e),
        };
        let right_area = match self.eval_node_as_intersection_area(right).await {
            Ok(Some(area)) => area,
            Ok(None) => return Ok(CellValue::Error(CellError::Null, None)),
            Err(ComputeError::Eval { .. }) => return Ok(CellValue::Error(CellError::Value, None)),
            Err(e) => return Err(e),
        };
        let Some((sheet, start_row, start_col, end_row, end_col)) =
            Self::intersect_ref_areas(left_area, right_area)
        else {
            return Ok(CellValue::Error(CellError::Null, None));
        };

        let start_ref = CellRef::Positional {
            sheet,
            row: start_row,
            col: start_col,
        };
        let end_ref = CellRef::Positional {
            sheet,
            row: end_row,
            col: end_col,
        };
        if start_row == end_row && start_col == end_col {
            return Ok(self.data.get_cell_value_by_ref(&start_ref).await);
        }
        match self
            .data
            .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
            .await
        {
            Ok(array) => Ok(CellValue::Array(array)),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }

    pub(super) fn is_referenceable_for_intersection(node: &ASTNode) -> bool {
        // This is a candidate classifier, not a guarantee of reference identity.
        // Names and INDEX can also yield ordinary values; callers must preserve
        // value evaluation when the runtime area probe cannot resolve a reference.
        match node {
            ASTNode::CellReference(_)
            | ASTNode::Range(_)
            | ASTNode::RangeOp { .. }
            | ASTNode::StructuredRef(_)
            | ASTNode::Identifier(_) => true,
            ASTNode::ExternalNameRef { workbook, .. } => workbook.is_current_workbook(),
            ASTNode::Function { name, .. } => {
                matches!(
                    name.to_ascii_uppercase().as_str(),
                    "INDEX" | "OFFSET" | "INDIRECT"
                )
            }
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Intersect,
                left,
                right,
            } => {
                Self::is_referenceable_for_intersection(left)
                    && Self::is_referenceable_for_intersection(right)
            }
            ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
                Self::is_referenceable_for_intersection(inner)
            }
            ASTNode::Paren(inner) => Self::is_referenceable_for_intersection(inner),
            _ => false,
        }
    }

    fn intersect_ref_areas(left: RefArea, right: RefArea) -> Option<RefArea> {
        let (left_sheet, left_start_row, left_start_col, left_end_row, left_end_col) = left;
        let (right_sheet, right_start_row, right_start_col, right_end_row, right_end_col) = right;
        if left_sheet != right_sheet {
            return None;
        }

        let start_row = left_start_row.max(right_start_row);
        let start_col = left_start_col.max(right_start_col);
        let end_row = left_end_row.min(right_end_row);
        let end_col = left_end_col.min(right_end_col);
        if start_row > end_row || start_col > end_col {
            None
        } else {
            Some((left_sheet, start_row, start_col, end_row, end_col))
        }
    }

    fn eval_node_as_intersection_area<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<RefArea>, ComputeError>> + 'b>,
    > {
        Box::pin(async move {
            match node {
                ASTNode::BinaryOp {
                    op: compute_parser::BinOp::Intersect,
                    left,
                    right,
                } => {
                    let Some(left_area) = self.eval_node_as_intersection_area(left).await? else {
                        return Ok(None);
                    };
                    let Some(right_area) = self.eval_node_as_intersection_area(right).await? else {
                        return Ok(None);
                    };
                    Ok(Self::intersect_ref_areas(left_area, right_area))
                }
                ASTNode::SheetRef { inner, .. } | ASTNode::Paren(inner) => {
                    self.eval_node_as_intersection_area(inner).await
                }
                ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                    match self.meta.sheet_by_name(sheet_name) {
                        Some(sheet_id) => {
                            let resolved = Self::patch_sheet_id(inner, sheet_id);
                            self.eval_node_as_intersection_area(&resolved).await
                        }
                        None => Err(ComputeError::Eval {
                            message: format!("Intersection: unknown sheet '{}'", sheet_name),
                        }),
                    }
                }
                _ => self.eval_node_as_area(node).await.map(Some),
            }
        })
    }

    #[allow(clippy::type_complexity)]
    pub(in crate::eval) fn eval_node_as_area<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<RefArea, ComputeError>> + 'b>>
    {
        Box::pin(async move {
            self.tick()?;
            self.push_depth()?;
            let result = self.eval_node_as_area_inner(node).await;
            self.pop_depth();
            result
        })
    }

    async fn eval_node_as_area_inner(&mut self, node: &ASTNode) -> Result<RefArea, ComputeError> {
        match node {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) =
                    self.resolve_cell_ref_position(reference).ok_or_else(|| {
                        ComputeError::Eval {
                            message: "RangeOp: cannot resolve cell reference".into(),
                        }
                    })?;
                Ok((sheet, row, col, row, col))
            }

            ASTNode::Range(RangeRef { start, end, .. }) => {
                let (s_sheet, s_row, s_col) =
                    self.resolve_cell_ref_position(start)
                        .ok_or_else(|| ComputeError::Eval {
                            message: "RangeOp: cannot resolve range start".into(),
                        })?;
                let (_, e_row, e_col) =
                    self.resolve_cell_ref_position(end)
                        .ok_or_else(|| ComputeError::Eval {
                            message: "RangeOp: cannot resolve range end".into(),
                        })?;
                Ok((
                    s_sheet,
                    s_row.min(e_row),
                    s_col.min(e_col),
                    s_row.max(e_row),
                    s_col.max(e_col),
                ))
            }

            ASTNode::SheetRef { sheet, inner } => {
                if let ASTNode::Identifier(name) = inner.as_ref() {
                    return self
                        .resolved_name_as_area(
                            self.meta.resolve_defined_name_for_sheet(name, *sheet),
                        )
                        .await;
                }
                let patched = Self::patch_sheet_id(inner, *sheet);
                self.eval_node_as_area(&patched).await
            }

            ASTNode::Identifier(name) => {
                self.resolved_name_as_area(self.meta.resolve_defined_name(name))
                    .await
            }
            ASTNode::ExternalNameRef { workbook, name } if workbook.is_current_workbook() => {
                self.resolved_name_as_area(self.meta.resolve_workbook_name(name))
                    .await
            }

            ASTNode::StructuredRef(reference) => {
                let resolved = self.meta.resolve_structured_ref(reference).map_err(|_| {
                    ComputeError::Eval {
                        message: "Cannot resolve table reference".into(),
                    }
                })?;
                let [range] = resolved.ranges.as_slice() else {
                    return Err(ComputeError::Eval {
                        message: "Table reference contains multiple areas".into(),
                    });
                };
                let Some((&first, rest)) = range.columns.split_first() else {
                    return Err(ComputeError::Eval {
                        message: "Table reference is empty".into(),
                    });
                };
                if rest
                    .iter()
                    .enumerate()
                    .any(|(index, &col)| col != first + index as u32 + 1)
                {
                    return Err(ComputeError::Eval {
                        message: "Table reference contains disjoint columns".into(),
                    });
                }
                Ok((
                    resolved.sheet,
                    range.start_row,
                    first,
                    range.end_row,
                    *range.columns.last().unwrap(),
                ))
            }

            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                match self.meta.sheet_by_name(sheet_name) {
                    Some(sheet_id) => {
                        if let ASTNode::Identifier(name) = inner.as_ref() {
                            return self
                                .resolved_name_as_area(
                                    self.meta.resolve_defined_name_for_sheet(name, sheet_id),
                                )
                                .await;
                        }
                        let resolved = Self::patch_sheet_id(inner, sheet_id);
                        self.eval_node_as_area(&resolved).await
                    }
                    None => Err(ComputeError::Eval {
                        message: format!("RangeOp: unknown sheet '{}'", sheet_name),
                    }),
                }
            }

            ASTNode::Paren(inner) => self.eval_node_as_area(inner).await,

            ASTNode::RangeOp { start, end } => {
                let (sheet, sr, sc, er, ec) = self.eval_node_as_area(start).await?;
                let (other_sheet, other_sr, other_sc, other_er, other_ec) =
                    self.eval_node_as_area(end).await?;
                if sheet != other_sheet {
                    return Err(ComputeError::Eval {
                        message: "Range endpoints belong to different sheets".into(),
                    });
                }
                Ok((
                    sheet,
                    sr.min(other_sr),
                    sc.min(other_sc),
                    er.max(other_er),
                    ec.max(other_ec),
                ))
            }

            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Intersect,
                ..
            } => self
                .eval_node_as_intersection_area(node)
                .await?
                .ok_or_else(|| ComputeError::Eval {
                    message: "Intersection: referenced areas do not overlap".into(),
                }),

            ASTNode::Function { name, args } => {
                let upper = name.to_uppercase();
                match upper.as_str() {
                    "INDEX" => self.eval_index_as_area(args).await,
                    "OFFSET" => self.eval_offset_as_area(args).await,
                    "INDIRECT" => {
                        let reference = self.indirect_reference_node(args).await?;
                        self.eval_node_as_area(&reference).await
                    }
                    _ => Err(ComputeError::Eval {
                        message: format!("RangeOp: function '{}' cannot produce a reference", name),
                    }),
                }
            }

            _ => Err(ComputeError::Eval {
                message: "RangeOp: expression cannot produce a reference".into(),
            }),
        }
    }
    async fn resolved_name_as_area(
        &mut self,
        resolved: Option<ResolvedName>,
    ) -> Result<RefArea, ComputeError> {
        match resolved {
            Some(ResolvedName::Cell { sheet, row, col }) => Ok((sheet, row, col, row, col)),
            Some(ResolvedName::Range {
                sheet,
                start_row,
                start_col,
                end_row,
                end_col,
            }) => Ok((
                sheet,
                start_row.min(end_row),
                start_col.min(end_col),
                start_row.max(end_row),
                start_col.max(end_col),
            )),
            Some(ResolvedName::Formula { raw_expression }) => {
                let node = super::reference_resolution::parse_defined_name_formula(
                    &raw_expression,
                    self.meta,
                )
                .ok_or_else(|| ComputeError::Eval {
                    message: "Cannot parse named reference".into(),
                })?;
                self.eval_node_as_area(&node).await
            }
            _ => Err(ComputeError::Eval {
                message: "Name does not identify a reference".into(),
            }),
        }
    }
}
