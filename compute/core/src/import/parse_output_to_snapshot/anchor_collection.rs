use cell_types::SheetId;
use domain_types::SheetData;
use formula_types::IdentityFormulaRef;
use ooxml_types::worksheet::CellFormulaType;
use rustc_hash::{FxHashMap, FxHashSet};
use snapshot_types::WorkbookSnapshot;

use crate::import::phantom::{parse_cell_ref, parse_range_ref};

/// Why a position needs durable cell identity even when no physical cell data exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum IdentityAnchorReason {
    Comment,
    /// A sheet-level AutoFilter range or header column needs a
    /// durable CellId so the runtime FilterState can resolve its range.
    AutoFilter,
    /// A floating object (form control, shape, picture, chart, OLE, connector)
    /// is anchored at this position. Covers both the start anchor and, for
    /// two-cell anchors, the end anchor so the whole anchored span gets durable
    /// identity even when it falls outside the populated cell extent.
    FloatingObject,
    /// A worksheet form control points at this cell as its linked value cell
    /// or list-fill range endpoint.
    FormControlReference,
}

/// Collect all (row, col) positions anchored by any feature on a sheet.
/// These cells must not be ranged by the import classifier.
pub(crate) fn collect_anchored_positions(
    sheet_data: &SheetData,
    sheet_id: &str,
    snapshot: &WorkbookSnapshot,
    cell_id_to_pos: Option<&FxHashMap<String, (u32, u32)>>,
) -> FxHashSet<(u32, u32)> {
    let mut anchored = FxHashSet::default();

    for pos in collect_identity_required_anchors(sheet_data).keys() {
        anchored.insert(*pos);
    }

    anchors_from_formulas(sheet_data, &mut anchored);
    anchors_from_rich_strings(sheet_data, &mut anchored);
    anchors_from_hyperlinks(sheet_data, &mut anchored);
    anchors_from_merges(sheet_data, &mut anchored);
    anchors_from_array_formulas(sheet_data, &mut anchored);
    anchors_from_cse_arrays(sheet_data, &mut anchored);
    anchors_from_conditional_formats(sheet_data, &mut anchored);
    anchors_from_validations(sheet_data, &mut anchored);
    anchors_from_floating_objects(sheet_data, &mut anchored);
    anchors_from_sparklines(sheet_data, &mut anchored);
    anchors_from_tables(snapshot, sheet_id, &mut anchored);
    anchors_from_named_ranges(snapshot, sheet_id, cell_id_to_pos, &mut anchored);
    anchors_from_pivots(snapshot, sheet_id, &mut anchored);
    anchors_from_data_tables(snapshot, sheet_id, &mut anchored);

    anchored
}

/// Collect positions that require durable CellId identity even when the XLSX
/// sheet has no `<c>` data entry at that position.
pub(crate) fn collect_identity_required_anchors(
    sheet_data: &SheetData,
) -> FxHashMap<(u32, u32), Vec<IdentityAnchorReason>> {
    let mut anchors = FxHashMap::default();
    identity_anchors_from_auto_filter(sheet_data, &mut anchors);
    identity_anchors_from_comments(sheet_data, &mut anchors);
    identity_anchors_from_floating_objects(sheet_data, &mut anchors);
    identity_anchors_from_form_control_references(sheet_data, &mut anchors);
    anchors
}

// === Per-sheet features ===

fn anchors_from_formulas(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for cell in &sheet_data.cells {
        if cell.formula.is_some() {
            out.insert((cell.row, cell.col));
        }
    }
}

fn anchors_from_rich_strings(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for cell in &sheet_data.cells {
        if cell.rich_string.is_some() {
            out.insert((cell.row, cell.col));
        }
    }
}

fn identity_anchors_from_comments(
    sheet_data: &SheetData,
    out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>,
) {
    for comment in &sheet_data.comments {
        if let Some(pos) = parse_cell_ref(&comment.cell_ref) {
            let reasons = out.entry(pos).or_default();
            if !reasons.contains(&IdentityAnchorReason::Comment) {
                reasons.push(IdentityAnchorReason::Comment);
            }
        }
    }
}

fn identity_anchors_from_auto_filter(
    sheet_data: &SheetData,
    out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>,
) {
    let Some(auto_filter) = &sheet_data.auto_filter else {
        return;
    };
    let Some((start_row, start_col, end_row, end_col)) = parse_range_ref(&auto_filter.range_ref)
    else {
        return;
    };

    let push = |out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>, pos: (u32, u32)| {
        let reasons = out.entry(pos).or_default();
        if !reasons.contains(&IdentityAnchorReason::AutoFilter) {
            reasons.push(IdentityAnchorReason::AutoFilter);
        }
    };

    push(out, (start_row, start_col));
    push(out, (start_row, end_col));
    push(out, (end_row, end_col));

    for col in start_col..=end_col {
        push(out, (start_row, col));
    }
}

fn identity_anchors_from_floating_objects(
    sheet_data: &SheetData,
    out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>,
) {
    let push = |out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>, pos: (u32, u32)| {
        let reasons = out.entry(pos).or_default();
        if !reasons.contains(&IdentityAnchorReason::FloatingObject) {
            reasons.push(IdentityAnchorReason::FloatingObject);
        }
    };
    for obj in &sheet_data.floating_objects {
        let anchor = &obj.common.anchor;
        push(out, (anchor.anchor_row, anchor.anchor_col));
        // Two-cell anchors also occupy an end cell; the renderer resolves the
        // span via `to_anchor_cell_id`, so that position needs identity too.
        if let (Some(end_row), Some(end_col)) = (anchor.end_row, anchor.end_col) {
            push(out, (end_row, end_col));
        }
    }
}

fn identity_anchors_from_form_control_references(
    sheet_data: &SheetData,
    out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>,
) {
    let push = |out: &mut FxHashMap<(u32, u32), Vec<IdentityAnchorReason>>, pos: (u32, u32)| {
        let reasons = out.entry(pos).or_default();
        if !reasons.contains(&IdentityAnchorReason::FormControlReference) {
            reasons.push(IdentityAnchorReason::FormControlReference);
        }
    };

    for obj in &sheet_data.floating_objects {
        let domain_types::domain::floating_object::FloatingObjectData::FormControl(control) =
            &obj.data
        else {
            continue;
        };

        if let Some(linked_cell) = control
            .cell_link
            .as_deref()
            .or_else(|| {
                control
                    .ooxml
                    .as_ref()
                    .and_then(|props| props.control_pr.as_ref())
                    .and_then(|control_pr| control_pr.linked_cell.as_deref())
            })
            .and_then(normalize_form_control_reference)
            .and_then(|reference| parse_cell_ref(&reference))
        {
            push(out, linked_cell);
        }

        if let Some((start_row, start_col, end_row, end_col)) = control
            .input_range
            .as_deref()
            .or_else(|| {
                control
                    .ooxml
                    .as_ref()
                    .and_then(|props| props.control_pr.as_ref())
                    .and_then(|control_pr| control_pr.list_fill_range.as_deref())
            })
            .and_then(normalize_form_control_reference)
            .and_then(|reference| parse_range_ref(&reference))
        {
            push(out, (start_row, start_col));
            push(out, (end_row, end_col));
        }
    }
}

fn normalize_form_control_reference(reference: &str) -> Option<String> {
    let mut normalized = reference.trim();
    if normalized.is_empty() || normalized.starts_with('{') {
        return None;
    }
    if (normalized.starts_with('"') && normalized.ends_with('"'))
        || (normalized.starts_with('\'') && normalized.ends_with('\''))
    {
        let quote = if normalized.starts_with('"') {
            '"'
        } else {
            '\''
        };
        normalized = normalized
            .strip_prefix(quote)
            .and_then(|value| value.strip_suffix(quote))
            .unwrap_or(normalized);
    }
    if let Some(rest) = normalized.strip_prefix('=') {
        normalized = rest.trim();
    }
    if let Some((_, local_ref)) = normalized.rsplit_once('!') {
        normalized = local_ref.trim();
    }
    (!normalized.is_empty()).then(|| normalized.to_string())
}

fn anchors_from_hyperlinks(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for hyperlink in &sheet_data.hyperlinks {
        if let Some(pos) = parse_cell_ref(&hyperlink.cell_ref) {
            out.insert(pos);
        }
    }
}

fn anchors_from_merges(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for merge in &sheet_data.merges {
        out.insert((merge.start_row, merge.start_col));
    }
}

fn anchors_from_array_formulas(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for cell in &sheet_data.cells {
        if cell.array_ref.is_some() {
            out.insert((cell.row, cell.col));
        }
    }
}

fn anchors_from_cse_arrays(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for cell in &sheet_data.cells {
        if let Some(cf) = &cell.cell_formula
            && matches!(cf.t, CellFormulaType::Shared | CellFormulaType::Array)
        {
            out.insert((cell.row, cell.col));
        }
    }
}

fn anchors_from_conditional_formats(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for cf in &sheet_data.conditional_formats {
        for range in &cf.ranges {
            out.insert((range.start_row(), range.start_col()));
            out.insert((range.start_row(), range.end_col()));
            out.insert((range.end_row(), range.start_col()));
            out.insert((range.end_row(), range.end_col()));
        }
    }
}

fn anchors_from_validations(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for validation in &sheet_data.data_validations {
        for range_str in &validation.ranges {
            if let Some((sr, sc, er, ec)) = parse_range_ref(range_str) {
                out.insert((sr, sc));
                out.insert((sr, ec));
                out.insert((er, sc));
                out.insert((er, ec));
            } else if let Some(pos) = parse_cell_ref(range_str) {
                out.insert(pos);
            }
        }
    }
}

fn anchors_from_floating_objects(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for obj in &sheet_data.floating_objects {
        out.insert((obj.common.anchor.anchor_row, obj.common.anchor.anchor_col));
    }
}

fn anchors_from_sparklines(sheet_data: &SheetData, out: &mut FxHashSet<(u32, u32)>) {
    for sparkline in &sheet_data.sparklines {
        out.insert((sparkline.cell.row, sparkline.cell.col));
    }
}

// === Cross-sheet features ===

fn anchors_from_tables(
    snapshot: &WorkbookSnapshot,
    sheet_id: &str,
    out: &mut FxHashSet<(u32, u32)>,
) {
    let Ok(target_sheet) = SheetId::from_uuid_str(sheet_id) else {
        return;
    };
    for table in &snapshot.tables {
        if table.sheet != target_sheet {
            continue;
        }
        if table.has_headers {
            for col in table.start_col..=table.end_col {
                out.insert((table.start_row, col));
            }
        }
    }
}

fn anchors_from_named_ranges(
    snapshot: &WorkbookSnapshot,
    sheet_id: &str,
    cell_id_to_pos: Option<&FxHashMap<String, (u32, u32)>>,
    out: &mut FxHashSet<(u32, u32)>,
) {
    let Some(cell_id_to_pos) = cell_id_to_pos else {
        return;
    };
    let target_sheet = SheetId::from_uuid_str(sheet_id).ok();
    for named_range in &snapshot.named_ranges {
        // Filter by scope: workbook-scoped applies to all sheets,
        // sheet-scoped only applies when the sheet matches.
        match &named_range.scope {
            formula_types::Scope::Sheet(sid) => {
                if target_sheet.as_ref() != Some(sid) {
                    continue;
                }
            }
            formula_types::Scope::Workbook => {}
        }
        for r in &named_range.refers_to.refs {
            match r {
                IdentityFormulaRef::Cell(cell_ref) => {
                    if let Some(&pos) = cell_id_to_pos.get(&cell_ref.id.to_uuid_string()) {
                        out.insert(pos);
                    }
                }
                IdentityFormulaRef::Range(range_ref) => {
                    if let Some(&pos) = cell_id_to_pos.get(&range_ref.start_id.to_uuid_string()) {
                        out.insert(pos);
                    }
                    if let Some(&pos) = cell_id_to_pos.get(&range_ref.end_id.to_uuid_string()) {
                        out.insert(pos);
                    }
                }
                IdentityFormulaRef::FullRow(..)
                | IdentityFormulaRef::RectRange(..)
                | IdentityFormulaRef::RowRange(..)
                | IdentityFormulaRef::FullCol(..)
                | IdentityFormulaRef::ColRange(..)
                | IdentityFormulaRef::ExternalCell(..)
                | IdentityFormulaRef::ExternalRange(..)
                | IdentityFormulaRef::ExternalName(..) => {}
            }
        }
    }
}

fn anchors_from_pivots(
    snapshot: &WorkbookSnapshot,
    sheet_id: &str,
    out: &mut FxHashSet<(u32, u32)>,
) {
    for pivot in &snapshot.pivot_tables {
        if pivot.sheet == sheet_id {
            out.insert((pivot.start_row, pivot.start_col));
        }
    }
}

fn anchors_from_data_tables(
    snapshot: &WorkbookSnapshot,
    sheet_id: &str,
    out: &mut FxHashSet<(u32, u32)>,
) {
    for dt in &snapshot.data_table_regions {
        if dt.sheet == sheet_id {
            out.insert((dt.start_row, dt.start_col));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{CellId, SheetId, SheetRange};
    use domain_types::{
        AutoFilter, Comment, ConditionalFormat, FilterColumn, FloatingObject, FloatingObjectAnchor,
        FloatingObjectCommon, FloatingObjectData, Hyperlink, MergeRegion, OoxmlFilterType,
        ShapeData, Sparkline, SparklineCellAddress, SparklineDataRange, SparklineType,
        ValidationSpec,
    };
    use formula_types::{
        IdentityCellRef, IdentityFormula, IdentityRangeRef, NamedRangeDef, Scope, TableDef,
    };
    use ooxml_types::worksheet::{CellFormula, CellFormulaType};
    use snapshot_types::{DataTableRegionDef, PivotTableDef};
    use value_types::CellValue;

    const SHEET_UUID: &str = "00000000-0000-0000-0000-000000000001";

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str(SHEET_UUID).unwrap()
    }

    fn make_cell(row: u32, col: u32) -> domain_types::CellData {
        domain_types::CellData {
            row,
            col,
            value: CellValue::Null,
            ..Default::default()
        }
    }

    fn make_formula_cell(row: u32, col: u32) -> domain_types::CellData {
        domain_types::CellData {
            formula: Some("=1".into()),
            ..make_cell(row, col)
        }
    }

    fn make_spill_cell(row: u32, col: u32) -> domain_types::CellData {
        domain_types::CellData {
            array_ref: Some("A1:B2".into()),
            ..make_cell(row, col)
        }
    }

    fn make_cse_cell(row: u32, col: u32, t: CellFormulaType) -> domain_types::CellData {
        domain_types::CellData {
            cell_formula: Some(CellFormula {
                t,
                ..Default::default()
            }),
            ..make_cell(row, col)
        }
    }

    fn build_fixture() -> (SheetData, WorkbookSnapshot, FxHashMap<String, (u32, u32)>) {
        let sid = sheet_id();

        // 1. Formula cell at (0, 0)
        // 5. Spill anchor at (0, 1)
        // 6a. CSE Shared at (0, 2)
        // 6b. CSE Array at (0, 3)
        // Plain cell (no anchors) at (0, 4)
        let cells = vec![
            make_formula_cell(0, 0),
            make_spill_cell(0, 1),
            make_cse_cell(0, 2, CellFormulaType::Shared),
            make_cse_cell(0, 3, CellFormulaType::Array),
            make_cell(0, 4),
        ];

        // 2. Comment at B2 → (1, 1)
        let comments = vec![Comment {
            cell_ref: "B2".into(),
            ..Default::default()
        }];

        // 3. Hyperlink at C3 → (2, 2)
        let hyperlinks = vec![Hyperlink {
            cell_ref: "C3".into(),
            ..Default::default()
        }];

        // 4. Merge at (3, 3)
        let merges = vec![MergeRegion {
            start_row: 3,
            start_col: 3,
            end_row: 4,
            end_col: 4,
        }];

        // 7. CF range (10,10)-(12,12) → 4 corners: (10,10),(10,12),(12,10),(12,12)
        let conditional_formats = vec![ConditionalFormat {
            id: "cf1".into(),
            sheet_id: String::new(),
            pivot: None,
            ranges: vec![SheetRange::new(10, 10, 12, 12)],
            range_identities: None,
            rules: vec![],
        }];

        // 8. Validation range "E5:G7" → (4,4)-(6,6) → 4 corners: (4,4),(4,6),(6,4),(6,6)
        let data_validations = vec![ValidationSpec {
            ranges: vec!["E5:G7".into()],
            ..Default::default()
        }];

        // 9. Floating object at (7, 7)
        let floating_objects = vec![FloatingObject {
            common: FloatingObjectCommon {
                anchor: FloatingObjectAnchor {
                    anchor_row: 7,
                    anchor_col: 7,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Shape(ShapeData::default()),
        }];

        // 10. Sparkline at (8, 8)
        let sparklines = vec![Sparkline {
            id: "sp1".into(),
            sheet_id: String::new(),
            cell: SparklineCellAddress {
                sheet_id: String::new(),
                row: 8,
                col: 8,
            },
            data_range: SparklineDataRange {
                source_sheet_name: None,
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            },
            sparkline_type: SparklineType::Line,
            data_in_rows: false,
            group_id: None,
            visual: Default::default(),
            axis: Default::default(),
            created_at: None,
            updated_at: None,
        }];

        let sheet_data = SheetData {
            cells,
            comments,
            hyperlinks,
            merges,
            conditional_formats,
            data_validations,
            floating_objects,
            sparklines,
            ..Default::default()
        };

        // 11. Table with headers, cols 20..=22 at row 20 → (20,20),(20,21),(20,22)
        let tables = vec![TableDef {
            name: "Table1".into(),
            sheet: sid,
            start_row: 20,
            start_col: 20,
            end_row: 25,
            end_col: 22,
            columns: vec!["A".into(), "B".into(), "C".into()],
            has_headers: true,
            has_totals: false,
        }];

        // 12. Named range: Cell ref at (30, 30), Range ref corners at (31, 31) and (32, 32)
        let nr_cell_id = CellId::from_raw(1001);
        let nr_range_start = CellId::from_raw(1002);
        let nr_range_end = CellId::from_raw(1003);

        let named_ranges = vec![NamedRangeDef {
            name: "MyName".into(),
            scope: Scope::Workbook,
            refers_to: IdentityFormula {
                template: "{0}+{1}".into(),
                refs: vec![
                    IdentityFormulaRef::Cell(IdentityCellRef {
                        id: nr_cell_id,
                        row_absolute: true,
                        col_absolute: true,
                    }),
                    IdentityFormulaRef::Range(IdentityRangeRef {
                        start_id: nr_range_start,
                        end_id: nr_range_end,
                        start_row_absolute: true,
                        start_col_absolute: true,
                        end_row_absolute: true,
                        end_col_absolute: true,
                    }),
                ],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: None,
            linked_range_id: None,
        }];

        let mut cell_id_to_pos = FxHashMap::default();
        cell_id_to_pos.insert(nr_cell_id.to_uuid_string(), (30, 30));
        cell_id_to_pos.insert(nr_range_start.to_uuid_string(), (31, 31));
        cell_id_to_pos.insert(nr_range_end.to_uuid_string(), (32, 32));

        // 13. Pivot at (40, 40)
        let pivot_tables = vec![PivotTableDef {
            id: "pivot-1".into(),
            name: "Pivot1".into(),
            sheet: SHEET_UUID.into(),
            start_row: 40,
            start_col: 40,
            end_row: 45,
            end_col: 45,
            rendered_rows: Some(6),
            rendered_cols: Some(6),
            first_data_row: 1,
            first_data_col: 1,
            data_field_names: vec![],
            cache_field_names: vec![],
            row_field_indices: vec![],
            col_field_indices: vec![],
            data_on_rows: false,
            style: None,
            show_row_grand_totals: None,
            show_column_grand_totals: None,
        }];

        // 14. Data table at (50, 50)
        let data_table_regions = vec![DataTableRegionDef {
            sheet: SHEET_UUID.into(),
            start_row: 50,
            start_col: 50,
            end_row: 55,
            end_col: 55,
            row_input_ref: None,
            col_input_ref: None,
            ooxml_flags: None,
        }];

        let snapshot = WorkbookSnapshot {
            tables,
            named_ranges,
            pivot_tables,
            data_table_regions,
            ..Default::default()
        };

        (sheet_data, snapshot, cell_id_to_pos)
    }

    #[test]
    fn anchored_positions_exhaustive() {
        let (sheet_data, snapshot, cell_id_to_pos) = build_fixture();

        // Per-type expected counts (all positions unique by construction):
        // 1. formulas: 1       → (0,0)
        // 2. comments: 1       → (1,1)
        // 3. hyperlinks: 1     → (2,2)
        // 4. merges: 1         → (3,3)
        // 5. spill anchors: 1  → (0,1)
        // 6. CSE arrays: 2     → (0,2), (0,3)
        // 7. CF corners: 4     → (10,10),(10,12),(12,10),(12,12)
        // 8. validations: 4    → (4,4),(4,6),(6,4),(6,6)
        // 9. floating: 1       → (7,7)
        // 10. sparklines: 1    → (8,8)
        // 11. table headers: 3 → (20,20),(20,21),(20,22)
        // 12. named ranges: 3  → (30,30),(31,31),(32,32)
        // 13. pivots: 1        → (40,40)
        // 14. data tables: 1   → (50,50)
        // Total: 25

        let result =
            collect_anchored_positions(&sheet_data, SHEET_UUID, &snapshot, Some(&cell_id_to_pos));

        assert_eq!(result.len(), 25, "total anchored positions");

        // Verify per-type via individual sub-functions.
        let mut out = FxHashSet::default();
        anchors_from_formulas(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "formulas");

        let identity_anchors = collect_identity_required_anchors(&sheet_data);
        // Comment at (1,1) + floating object at (7,7).
        assert_eq!(identity_anchors.len(), 2, "identity-required anchors");
        let reasons = identity_anchors
            .get(&(1, 1))
            .expect("comment identity anchor");
        assert_eq!(reasons, &[IdentityAnchorReason::Comment]);
        let fo_reasons = identity_anchors
            .get(&(7, 7))
            .expect("floating-object identity anchor");
        assert_eq!(fo_reasons, &[IdentityAnchorReason::FloatingObject]);

        out.clear();
        anchors_from_hyperlinks(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "hyperlinks");

        out.clear();
        anchors_from_merges(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "merges");

        out.clear();
        anchors_from_array_formulas(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "spill anchors");

        out.clear();
        anchors_from_cse_arrays(&sheet_data, &mut out);
        assert_eq!(out.len(), 2, "CSE arrays");

        out.clear();
        anchors_from_conditional_formats(&sheet_data, &mut out);
        assert_eq!(out.len(), 4, "conditional formats");

        out.clear();
        anchors_from_validations(&sheet_data, &mut out);
        assert_eq!(out.len(), 4, "validations");

        out.clear();
        anchors_from_floating_objects(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "floating objects");

        out.clear();
        anchors_from_sparklines(&sheet_data, &mut out);
        assert_eq!(out.len(), 1, "sparklines");

        out.clear();
        anchors_from_tables(&snapshot, SHEET_UUID, &mut out);
        assert_eq!(out.len(), 3, "table headers");

        out.clear();
        anchors_from_named_ranges(&snapshot, SHEET_UUID, Some(&cell_id_to_pos), &mut out);
        assert_eq!(out.len(), 3, "named ranges");

        out.clear();
        anchors_from_pivots(&snapshot, SHEET_UUID, &mut out);
        assert_eq!(out.len(), 1, "pivots");

        out.clear();
        anchors_from_data_tables(&snapshot, SHEET_UUID, &mut out);
        assert_eq!(out.len(), 1, "data tables");

        let per_type_sum = 1 + 1 + 1 + 1 + 1 + 2 + 4 + 4 + 1 + 1 + 3 + 3 + 1 + 1;
        assert_eq!(result.len(), per_type_sum, "total matches per-type sum");
    }

    fn make_floating_object(
        anchor_row: u32,
        anchor_col: u32,
        end: Option<(u32, u32)>,
    ) -> FloatingObject {
        let (end_row, end_col) = match end {
            Some((r, c)) => (Some(r), Some(c)),
            None => (None, None),
        };
        FloatingObject {
            common: FloatingObjectCommon {
                anchor: FloatingObjectAnchor {
                    anchor_row,
                    anchor_col,
                    end_row,
                    end_col,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Shape(ShapeData::default()),
        }
    }

    /// Regression: floating objects anchored outside the populated cell extent
    /// (e.g. legacy VML form controls in column B of an otherwise column-A
    /// sheet) must contribute identity-required anchors so their anchor cells
    /// get durable identity and are mirrored into the grid index. Previously
    /// `collect_identity_required_anchors` only included comments, so these
    /// anchor cellIds were dangling and the controls never rendered.
    #[test]
    fn floating_object_anchors_are_identity_required() {
        // One-cell anchored control in column B (col index 1) — the failing
        // VML-form-control case. Plus a two-cell anchored shape whose end anchor
        // is in a separate cell.
        let sheet_data = SheetData {
            floating_objects: vec![
                make_floating_object(3, 1, None),
                make_floating_object(5, 5, Some((9, 9))),
            ],
            ..Default::default()
        };

        let anchors = collect_identity_required_anchors(&sheet_data);

        // Start anchor of the one-cell control.
        assert_eq!(
            anchors.get(&(3, 1)).map(Vec::as_slice),
            Some([IdentityAnchorReason::FloatingObject].as_slice()),
            "one-cell control anchor in column B must be identity-required"
        );
        // Start AND end anchor of the two-cell shape.
        assert_eq!(
            anchors.get(&(5, 5)).map(Vec::as_slice),
            Some([IdentityAnchorReason::FloatingObject].as_slice()),
            "two-cell shape start anchor must be identity-required"
        );
        assert_eq!(
            anchors.get(&(9, 9)).map(Vec::as_slice),
            Some([IdentityAnchorReason::FloatingObject].as_slice()),
            "two-cell shape end anchor must be identity-required"
        );
        assert_eq!(anchors.len(), 3, "exactly the three anchor positions");
    }

    #[test]
    fn auto_filter_header_columns_are_identity_required() {
        let sheet_data = SheetData {
            auto_filter: Some(AutoFilter {
                range_ref: "A1:D12".to_string(),
                columns: vec![FilterColumn {
                    col_index: 2,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: vec!["KeepCo".to_string()],
                        blanks: false,
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        };

        let anchors = collect_identity_required_anchors(&sheet_data);

        for col in 0..=3 {
            assert_eq!(
                anchors.get(&(0, col)).map(Vec::as_slice),
                Some([IdentityAnchorReason::AutoFilter].as_slice()),
                "AutoFilter header col {col} must be identity-required even without filterColumn metadata"
            );
        }
        assert_eq!(
            anchors.get(&(11, 3)).map(Vec::as_slice),
            Some([IdentityAnchorReason::AutoFilter].as_slice()),
            "AutoFilter data-end corner must be identity-required"
        );
        assert_eq!(
            anchors.len(),
            5,
            "A1:D12 requires four header anchors plus the data-end corner"
        );
    }
}
