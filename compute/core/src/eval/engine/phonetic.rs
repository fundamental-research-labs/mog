//! Reference-aware PHONETIC extraction.
//!
//! `FnPhonetic` in `compute-functions` remains the value-to-value fallback for
//! literal arguments. A cell reference carries another semantic channel: its
//! imported rich shared-string record may contain ordered SpreadsheetML
//! phonetic runs. The evaluator must resolve the reference first and then use
//! this module to validate and extract that cell-owned state.

use super::super::GLOBAL_REGISTRY;
use super::reference_resolution::parse_defined_name_formula;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use cell_types::SheetId;
use compute_parser::ASTNode;
use domain_types::RichSharedString;
use formula_types::{CellRef, ResolvedName};
use value_types::{CellError, CellValue};

/// Extract PHONETIC output for a resolved cell reference.
///
/// The caller is responsible for resolving the argument to the upper-left
/// cell of one contiguous area and for rejecting non-contiguous references.
/// It supplies the current value from the evaluation data context, the
/// cell-owned `RichSharedString` from the metadata provider:
///
/// Cell errors propagate before metadata lookup. A run record is usable only
/// while its `plain_text` still equals the current value, matching the
/// freshness guard used by render/export. Missing, stale, and no-run records
/// preserve the current value through the same coercion as `FnPhonetic`.
/// Runs are concatenated in their stored XML order; `start_index` and
/// `end_index` describe their base-text spans and do not define a sort order.
#[must_use]
pub(crate) fn extract_phonetic_reference(
    current_value: &CellValue,
    rich_string: Option<&RichSharedString>,
) -> CellValue {
    if let CellValue::Error(error, message) = current_value {
        return CellValue::Error(*error, message.clone());
    }

    let current_text = match current_value.coerce_to_string() {
        Ok(text) => text.into_owned(),
        Err(error) => return CellValue::Error(error, None),
    };

    let Some(rich_string) = rich_string else {
        return CellValue::Text(current_text.into());
    };

    // Rich shared-string records belong to text cells. A numeric/boolean
    // value can coerce to the same characters, but that coercion does not make
    // an imported string record current for the cell.
    if !matches!(current_value, CellValue::Text(_)) || rich_string.plain_text != current_text {
        return CellValue::Text(current_text.into());
    }

    if rich_string.phonetic_runs.is_empty() {
        // OOXML/Excel can preserve phoneticPr without any rPh children (for
        // example type="noConversion"). PHONETIC's no-run result is
        // unspecified; retain the historical value fallback instead of
        // inventing a metadata-presence error.
        return CellValue::Text(current_text.into());
    }

    let capacity = rich_string
        .phonetic_runs
        .iter()
        .map(|run| run.text.len())
        .sum();
    let mut phonetic_text = String::with_capacity(capacity);
    for run in &rich_string.phonetic_runs {
        phonetic_text.push_str(&run.text);
    }
    CellValue::Text(phonetic_text.into())
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> super::evaluator::Evaluator<'a, D, M> {
    /// Evaluate PHONETIC while preserving reference identity long enough to
    /// inspect the selected cell's rich shared-string metadata.
    ///
    /// Literal/value expressions use the registered pure function. Reference
    /// candidates first go through the shared contiguous-area resolver, which
    /// also handles names and reference-producing INDEX/OFFSET/INDIRECT calls.
    /// This prevents the generic evaluator from collapsing a range or union to
    /// a value before PHONETIC can select its upper-left cell.
    pub(super) async fn eval_phonetic(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, value_types::ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        let argument = &args[0];
        if is_explicit_non_contiguous_reference(argument)
            || self.is_non_contiguous_structured_reference(argument)
        {
            return Ok(CellValue::Error(CellError::Na, None));
        }

        if is_reference_candidate(argument) {
            match self.eval_node_as_area(argument).await {
                Ok((sheet, row, col, _, _)) => {
                    let value = self
                        .data
                        .get_cell_value_by_ref(&CellRef::Positional { sheet, row, col })
                        .await;
                    let rich_string = self.meta.phonetic_shared_string(&sheet, row, col);
                    return Ok(extract_phonetic_reference(&value, rich_string.as_ref()));
                }
                // Names and reference-producing functions can legally produce
                // ordinary values. If area resolution failed because an alias
                // concealed a union, expand it now; successful references do
                // not get evaluated a second time just for classification.
                Err(value_types::ComputeError::Eval { .. }) => {
                    if self.is_non_contiguous_reference_expression(argument).await {
                        return Ok(CellValue::Error(CellError::Na, None));
                    }
                }
                Err(error) => return Err(error),
            }
        }

        let value = self.eval_node_cv(argument).await?;
        if value.is_error() {
            return Ok(value);
        }
        Ok(GLOBAL_REGISTRY.call("PHONETIC", &[value]))
    }

    /// Structured references can resolve to multiple ranges or to disjoint
    /// columns even though their AST has no explicit `Union` node. Keep those
    /// cases on PHONETIC's #N/A path before the normal structured-reference
    /// evaluator materializes an array.
    fn is_non_contiguous_structured_reference(&self, node: &ASTNode) -> bool {
        match node {
            ASTNode::StructuredRef(reference) => {
                let Ok(resolved) = self.meta.resolve_structured_ref(reference) else {
                    return false;
                };
                let [range] = resolved.ranges.as_slice() else {
                    return true;
                };
                let Some((&first, rest)) = range.columns.split_first() else {
                    return true;
                };
                rest.iter()
                    .enumerate()
                    .any(|(index, &column)| column != first + index as u32 + 1)
            }
            // Intersections are classified by their final overlap in
            // `eval_node_as_area`; do not classify an operand independently
            // before that resolver determines the supported final geometry.
            ASTNode::SheetRef { inner, .. }
            | ASTNode::UnresolvedSheetRef { inner, .. }
            | ASTNode::Paren(inner) => self.is_non_contiguous_structured_reference(inner),
            _ => false,
        }
    }

    /// Expand reference-producing aliases after a contiguous-area probe fails.
    ///
    /// `eval_node_as_area` intentionally returns an error for a union, which
    /// is the right result for most callers but loses PHONETIC's specified
    /// `#N/A` when a union is hidden behind a defined name or a reference
    /// function. This bounded worklist follows only reference-producing forms
    /// and names; it does not evaluate arbitrary formula expressions. A
    /// successful area resolution never reaches this probe.
    async fn is_non_contiguous_reference_expression(&mut self, node: &ASTNode) -> bool {
        const MAX_REFERENCE_EXPANSIONS: u8 = 16;
        type PendingReference = (ASTNode, Option<SheetId>, u8);

        let mut pending: Vec<PendingReference> = vec![(node.clone(), None, 0)];
        while let Some((current, scope, depth)) = pending.pop() {
            if is_explicit_non_contiguous_reference(&current)
                || self.is_non_contiguous_structured_reference(&current)
            {
                return true;
            }
            if depth >= MAX_REFERENCE_EXPANSIONS {
                continue;
            }
            let next_depth = depth + 1;

            match current {
                ASTNode::Identifier(name) => {
                    let resolved = match scope {
                        Some(sheet) => self.meta.resolve_defined_name_for_sheet(&name, sheet),
                        None => self.meta.resolve_defined_name(&name),
                    };
                    self.enqueue_resolved_name(resolved, scope, next_depth, &mut pending);
                }
                ASTNode::ExternalNameRef { workbook, name } => {
                    if workbook.is_current_workbook() {
                        let resolved = self.meta.resolve_workbook_name(&name);
                        self.enqueue_resolved_name(resolved, scope, next_depth, &mut pending);
                    }
                }
                ASTNode::SheetRef { sheet, inner } => {
                    pending.push((*inner, Some(sheet), next_depth));
                }
                ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                    if let Some(sheet) = self.meta.sheet_by_name(&sheet_name) {
                        pending.push((*inner, Some(sheet), next_depth));
                    }
                }
                ASTNode::ExternalSheetRef { .. } => {}
                ASTNode::Paren(inner) => {
                    pending.push((*inner, scope, next_depth));
                }
                ASTNode::RangeOp { start, end } => {
                    pending.push((*start, scope, next_depth));
                    pending.push((*end, scope, next_depth));
                }
                ASTNode::Function { name, args } => {
                    let upper = name.to_ascii_uppercase();
                    match upper.as_str() {
                        "INDEX" | "OFFSET" => {
                            if let Some(source) = args.into_iter().next() {
                                pending.push((source, scope, next_depth));
                            }
                        }
                        "INDIRECT" => {
                            if let Some(reference) =
                                self.indirect_reference_for_phonetic(&args).await
                            {
                                pending.push((reference, None, next_depth));
                            }
                        }
                        _ => {}
                    }
                }
                // Keep the union arm explicit even though the guard above
                // normally returns first. A union is itself a multi-area
                // reference; do not traverse members and accidentally turn it
                // into a contiguous PHONETIC argument.
                ASTNode::Union { .. } => return true,
                // An intersection's final geometry is resolved by
                // `eval_node_as_area`; its operands are not independently
                // PHONETIC arguments. In particular, do not turn an overlap
                // that reduces to one contiguous cell into a premature #N/A.
                ASTNode::BinaryOp {
                    op: compute_parser::BinOp::Intersect,
                    ..
                }
                | ASTNode::StructuredRef(_)
                | ASTNode::CellReference(_)
                | ASTNode::Range(_)
                | ASTNode::Number(_)
                | ASTNode::Text(_)
                | ASTNode::Boolean(_)
                | ASTNode::Error(_)
                | ASTNode::Omitted
                | ASTNode::OptionalLambdaParam(_)
                | ASTNode::ThreeDRef { .. }
                | ASTNode::UnresolvedThreeDRef { .. }
                | ASTNode::ExternalThreeDRef { .. }
                | ASTNode::Array { .. }
                | ASTNode::BinaryOp { .. }
                | ASTNode::UnaryOp { .. }
                | ASTNode::CallExpression { .. } => {}
            }
        }
        false
    }

    fn enqueue_resolved_name(
        &self,
        resolved: Option<ResolvedName>,
        scope: Option<SheetId>,
        depth: u8,
        pending: &mut Vec<(ASTNode, Option<SheetId>, u8)>,
    ) {
        let Some(ResolvedName::Formula { raw_expression }) = resolved else {
            return;
        };
        if let Some(node) = parse_defined_name_formula(&raw_expression, self.meta) {
            pending.push((node, scope, depth));
        }
    }

    /// Resolve an INDIRECT argument for the non-contiguous-reference probe.
    /// The shared INDIRECT resolver is authoritative when it accepts the
    /// syntax. If it rejects a parsed union, inspect the textual reference so
    /// PHONETIC can still preserve the documented union error.
    async fn indirect_reference_for_phonetic(&mut self, args: &[ASTNode]) -> Option<ASTNode> {
        if args.is_empty() || args.len() > 2 {
            return None;
        }
        if let Ok(reference) = self.indirect_reference_node(args).await
            && !matches!(reference, ASTNode::Error(_))
        {
            return Some(reference);
        }

        if args.len() == 2 && !matches!(args[1], ASTNode::Omitted) {
            let a1 = self
                .eval_node_cv(&args[1])
                .await
                .ok()?
                .coerce_to_bool()
                .ok()?;
            if !a1 {
                return None;
            }
        }
        let value = self.eval_node_cv(&args[0]).await.ok()?;
        let text = value.coerce_to_string().ok()?.into_owned();
        parse_defined_name_formula(&text, self.meta)
    }
}

/// Return whether an argument is a candidate for contiguous reference
/// resolution. The area resolver remains the source of truth for whether a
/// candidate actually resolves to an area.
fn is_reference_candidate(node: &ASTNode) -> bool {
    match node {
        ASTNode::CellReference(_)
        | ASTNode::Range(_)
        | ASTNode::RangeOp { .. }
        | ASTNode::StructuredRef(_)
        | ASTNode::Identifier(_) => true,
        ASTNode::ExternalNameRef { workbook, .. } => workbook.is_current_workbook(),
        ASTNode::Function { name, .. } => matches!(
            name.to_ascii_uppercase().as_str(),
            "INDEX" | "OFFSET" | "INDIRECT"
        ),
        ASTNode::BinaryOp {
            op: compute_parser::BinOp::Intersect,
            left,
            right,
        } => is_reference_candidate(left) && is_reference_candidate(right),
        ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
            is_reference_candidate(inner)
        }
        ASTNode::Paren(inner) => is_reference_candidate(inner),
        _ => false,
    }
}

/// Return whether the argument explicitly denotes multiple areas/sheets.
///
/// `eval_union` materializes a union as an ordinary array, so this check must
/// happen before generic evaluation; otherwise PHONETIC would report #VALUE!
/// instead of the specified #N/A for non-contiguous references.
fn is_explicit_non_contiguous_reference(node: &ASTNode) -> bool {
    match node {
        ASTNode::Union { .. }
        | ASTNode::ThreeDRef { .. }
        | ASTNode::UnresolvedThreeDRef { .. }
        | ASTNode::ExternalThreeDRef { .. } => true,
        ASTNode::ExternalSheetRef { inner, .. }
        | ASTNode::SheetRef { inner, .. }
        | ASTNode::UnresolvedSheetRef { inner, .. }
        | ASTNode::Paren(inner) => is_explicit_non_contiguous_reference(inner),
        ASTNode::RangeOp { start, end } => {
            is_explicit_non_contiguous_reference(start) || is_explicit_non_contiguous_reference(end)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::extract_phonetic_reference;
    use crate::cells::CellStore;
    use crate::cells::cell_metadata::{CellMetadataProvider, CellReferenceMetadata};
    use crate::eval::context::traits::sync_block_on;
    use crate::eval::engine::evaluator::Evaluator;
    use crate::eval_bridge::EvalContext;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use cell_types::{CellId, SheetId};
    use compute_parser::{ASTNode, BinOp, CellRefNode, RangeRef};
    use domain_types::{PhoneticProperties, PhoneticRun, RichSharedString};
    use formula_types::{CellRef, NamedRangeDef, RangeType, Scope};
    use std::collections::HashMap;
    use std::sync::Arc;
    use value_types::{CellError, CellValue, FiniteF64};

    fn rich(plain_text: &str, phonetic_runs: Vec<PhoneticRun>) -> RichSharedString {
        RichSharedString {
            plain_text: plain_text.to_string(),
            phonetic_runs,
            ..RichSharedString::default()
        }
    }

    fn run(text: &str, start_index: u32, end_index: u32) -> PhoneticRun {
        PhoneticRun {
            text: text.to_string(),
            start_index,
            end_index,
        }
    }

    #[derive(Debug, Default)]
    struct TestPhoneticProvider {
        records: HashMap<(SheetId, u32, u32), RichSharedString>,
    }

    impl CellMetadataProvider for TestPhoneticProvider {
        fn rich_shared_string(
            &self,
            _cell_store: &CellStore,
            sheet: &SheetId,
            row: u32,
            col: u32,
        ) -> Option<RichSharedString> {
            self.records.get(&(*sheet, row, col)).cloned()
        }

        fn query(
            &self,
            _cell_store: &CellStore,
            _sheet: &SheetId,
            _row: u32,
            _col: u32,
        ) -> Option<CellReferenceMetadata> {
            None
        }
    }

    fn test_cell_uuid(row: u32, col: u32) -> String {
        format!("00000000-0000-0000-0000-0000{:04x}{:04x}", row, col)
    }

    fn test_cell_id(row: u32, col: u32) -> CellId {
        CellId::from_uuid_str(&test_cell_uuid(row, col)).unwrap()
    }

    fn production_fixture(
        a1_value: CellValue,
        records: impl IntoIterator<Item = ((u32, u32), RichSharedString)>,
    ) -> (CellStore, SheetId) {
        production_fixture_with_names(a1_value, records, Vec::new())
    }

    fn production_fixture_with_names(
        a1_value: CellValue,
        records: impl IntoIterator<Item = ((u32, u32), RichSharedString)>,
        named_ranges: Vec<NamedRangeDef>,
    ) -> (CellStore, SheetId) {
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-0000-0000-000000000001".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![
                    CellData {
                        cell_id: test_cell_uuid(0, 0),
                        row: 0,
                        col: 0,
                        value: a1_value,
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: test_cell_uuid(0, 1),
                        row: 0,
                        col: 1,
                        value: CellValue::Text("大阪".into()),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
                identities: vec![],
                row_axis: None,
                col_axis: None,
            }],
            axis_run_high_water_mark: None,
            identity_high_water_mark: None,
            canonical_tables: vec![],
            named_ranges,
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: FiniteF64::must(0.001),
            calculation_settings: None,
        };
        let mut cell_store = CellStore::from_snapshot(snapshot).unwrap();
        let sheet = cell_store.sheet_by_name("Sheet1").unwrap();
        cell_store.install_cell_metadata_provider(Arc::new(TestPhoneticProvider {
            records: records
                .into_iter()
                .map(|((row, col), rich)| ((sheet, row, col), rich))
                .collect(),
        }));
        (cell_store, sheet)
    }

    fn cell_reference(sheet: SheetId, row: u32, col: u32) -> ASTNode {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { sheet, row, col },
            abs_row: false,
            abs_col: false,
        })
    }

    fn phonetic(argument: ASTNode) -> ASTNode {
        ASTNode::Function {
            name: "PHONETIC".into(),
            args: vec![argument],
        }
    }

    fn evaluate_production(node: &ASTNode, cell_store: &CellStore, sheet: SheetId) -> CellValue {
        let context = EvalContext::new(cell_store, test_cell_id(0, 0), sheet);
        sync_block_on(Evaluator::evaluate(node, &context, &context)).unwrap()
    }

    #[test]
    fn production_dispatch_extracts_runs_and_selects_upper_left_reference() {
        let (cell_store, sheet) = production_fixture_with_names(
            CellValue::Text("東京".into()),
            [(
                (0, 0),
                rich("東京", vec![run("トウ", 0, 1), run("キョウ", 1, 2)]),
            )],
            vec![
                NamedRangeDef::from_expression(
                    "TokyoCell".into(),
                    Scope::Workbook,
                    "=Sheet1!A1".into(),
                ),
                NamedRangeDef::from_expression(
                    "DisjointCells".into(),
                    Scope::Workbook,
                    "=(Sheet1!A1,Sheet1!B1)".into(),
                ),
            ],
        );
        let a1 = cell_reference(sheet, 0, 0);
        let range = ASTNode::Range(RangeRef::new(
            CellRef::Positional {
                sheet,
                row: 0,
                col: 0,
            },
            CellRef::Positional {
                sheet,
                row: 0,
                col: 1,
            },
            RangeType::CellRange,
        ));
        let index = ASTNode::Function {
            name: "INDEX".into(),
            args: vec![a1.clone(), ASTNode::Number(1.0)],
        };
        let named = ASTNode::Identifier("TokyoCell".to_string());
        let named_union = ASTNode::Identifier("DisjointCells".to_string());
        let indirect_union = ASTNode::Function {
            name: "INDIRECT".into(),
            args: vec![ASTNode::Text("(A1,B1)".into())],
        };
        let indirect = ASTNode::Function {
            name: "INDIRECT".into(),
            args: vec![ASTNode::Text("A1".into())],
        };
        let index_union = ASTNode::Function {
            name: "INDEX".into(),
            args: vec![named_union.clone(), ASTNode::Number(1.0)],
        };
        let offset_union = ASTNode::Function {
            name: "OFFSET".into(),
            args: vec![
                named_union.clone(),
                ASTNode::Number(0.0),
                ASTNode::Number(0.0),
            ],
        };
        let intersection = ASTNode::BinaryOp {
            op: BinOp::Intersect,
            left: Box::new(ASTNode::Range(RangeRef::new(
                CellRef::Positional {
                    sheet,
                    row: 0,
                    col: 0,
                },
                CellRef::Positional {
                    sheet,
                    row: 0,
                    col: 1,
                },
                RangeType::CellRange,
            ))),
            right: Box::new(ASTNode::Range(RangeRef::new(
                CellRef::Positional {
                    sheet,
                    row: 0,
                    col: 1,
                },
                CellRef::Positional {
                    sheet,
                    row: 0,
                    col: 1,
                },
                RangeType::CellRange,
            ))),
        };

        assert_eq!(
            evaluate_production(&phonetic(a1), &cell_store, sheet),
            CellValue::Text("トウキョウ".into())
        );
        assert_eq!(
            evaluate_production(&phonetic(range), &cell_store, sheet),
            CellValue::Text("トウキョウ".into())
        );
        assert_eq!(
            evaluate_production(&phonetic(index), &cell_store, sheet),
            CellValue::Text("トウキョウ".into())
        );
        assert_eq!(
            evaluate_production(&phonetic(named), &cell_store, sheet),
            CellValue::Text("トウキョウ".into())
        );
        assert_eq!(
            evaluate_production(&phonetic(indirect), &cell_store, sheet),
            CellValue::Text("トウキョウ".into())
        );
        assert_eq!(
            evaluate_production(&phonetic(named_union), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(indirect_union), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(index_union), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(offset_union), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(intersection), &cell_store, sheet),
            CellValue::Text("大阪".into())
        );
    }

    #[test]
    fn production_dispatch_rejects_union_and_falls_back_for_missing_or_stale_metadata() {
        let (cell_store, sheet) = production_fixture(
            CellValue::Text("東京".into()),
            [((0, 0), rich("東京", Vec::new()))],
        );
        let union = ASTNode::Union {
            ranges: vec![cell_reference(sheet, 0, 0), cell_reference(sheet, 0, 1)],
        };
        let three_d = ASTNode::ThreeDRef {
            start_sheet: sheet,
            end_sheet: sheet,
            inner: Box::new(cell_reference(sheet, 0, 0)),
        };
        assert_eq!(
            evaluate_production(&phonetic(union), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(three_d), &cell_store, sheet),
            CellValue::Error(CellError::Na, None)
        );
        assert_eq!(
            evaluate_production(&phonetic(cell_reference(sheet, 0, 1)), &cell_store, sheet),
            CellValue::Text("大阪".into())
        );

        let (stale_cell_store, stale_sheet) = production_fixture(
            CellValue::Text("大阪".into()),
            [((0, 0), rich("東京", vec![run("トウキョウ", 0, 2)]))],
        );
        assert_eq!(
            evaluate_production(
                &phonetic(cell_reference(stale_sheet, 0, 0)),
                &stale_cell_store,
                stale_sheet,
            ),
            CellValue::Text("大阪".into())
        );
    }

    #[test]
    fn production_dispatch_propagates_selected_cell_error_and_keeps_literals_value_based() {
        let (cell_store, sheet) = production_fixture(
            CellValue::Error(CellError::Ref, None),
            [((0, 0), rich("東京", vec![run("トウキョウ", 0, 2)]))],
        );
        assert_eq!(
            evaluate_production(&phonetic(cell_reference(sheet, 0, 0)), &cell_store, sheet,),
            CellValue::Error(CellError::Ref, None)
        );
        assert_eq!(
            evaluate_production(
                &phonetic(ASTNode::Text("Tokyo".to_string())),
                &cell_store,
                sheet,
            ),
            CellValue::Text("Tokyo".into())
        );
    }

    #[test]
    fn extracts_runs_in_authored_order() {
        // Spans intentionally arrive out of positional order. SpreadsheetML
        // preserves authored rPh order, which is the order PHONETIC exposes.
        let metadata = rich("東京", vec![run("キョウ", 1, 2), run("トウ", 0, 1)]);
        let value = CellValue::Text("東京".into());
        assert_eq!(
            extract_phonetic_reference(&value, Some(&metadata)),
            CellValue::Text("キョウトウ".into())
        );
    }

    #[test]
    fn stale_metadata_is_not_replayed_after_text_edit() {
        let metadata = rich("東京", vec![run("トウキョウ", 0, 2)]);
        let value = CellValue::Text("大阪".into());
        assert_eq!(
            extract_phonetic_reference(&value, Some(&metadata)),
            CellValue::Text("大阪".into())
        );
    }

    #[test]
    fn no_runs_preserve_current_text_when_record_is_current() {
        let mut metadata = rich("plain", Vec::new());
        metadata.phonetic_properties = Some(PhoneticProperties {
            phonetic_type: Some("noConversion".to_string()),
            ..PhoneticProperties::default()
        });
        let value = CellValue::Text("plain".into());
        assert_eq!(
            extract_phonetic_reference(&value, Some(&metadata)),
            CellValue::Text("plain".into())
        );
    }

    #[test]
    fn missing_record_uses_existing_text_fallback() {
        let value = CellValue::Text("foo bar baz qux".into());
        assert_eq!(
            extract_phonetic_reference(&value, None),
            CellValue::Text("foo bar baz qux".into())
        );
    }

    #[test]
    fn missing_record_uses_existing_value_coercion() {
        let value = CellValue::from(42_i32);
        assert_eq!(
            extract_phonetic_reference(&value, None),
            CellValue::Text("42".into())
        );
    }

    #[test]
    fn non_text_value_does_not_consume_matching_rich_string_runs() {
        let metadata = rich("42", vec![run("四十二", 0, 1)]);
        let value = CellValue::from(42_i32);
        assert_eq!(
            extract_phonetic_reference(&value, Some(&metadata)),
            CellValue::Text("42".into())
        );
    }

    #[test]
    fn populated_runs_are_used_without_a_formatting_culture_gate() {
        let metadata = rich("東京", vec![run("トウキョウ", 0, 2)]);
        let value = CellValue::Text("東京".into());
        assert_eq!(
            extract_phonetic_reference(&value, Some(&metadata)),
            CellValue::Text("トウキョウ".into())
        );
    }

    #[test]
    fn current_cell_errors_propagate_before_metadata_policy() {
        let value = CellValue::Error(CellError::Ref, None);
        assert_eq!(
            extract_phonetic_reference(&value, None),
            CellValue::Error(CellError::Ref, None)
        );
    }
}
