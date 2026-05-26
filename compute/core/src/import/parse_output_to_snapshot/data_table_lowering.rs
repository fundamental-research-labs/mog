//! Data-table (what-if-analysis) region lowering — boundaries 1.5–1.7 + 3.3.
//!
//! Typed data-table input refs: with both `domain_types::DataTableRegion` (parser side) and
//! `snapshot_types::DataTableRegionDef` (snapshot side) carrying typed
//! `Option<CellRef>`, this lowering is a stateless structural copy. The
//! parser-side classifier (`compute_parser::parse_a1_cell` in
//! `domain/cells/parsing.rs::parse_data_table_input_ref`) already handled the
//! `#REF!` / non-cell shapes upstream — no classification happens at the
//! lowering boundary.

use domain_types::ParseOutput;
use snapshot_types::DataTableRegionDef;

use super::SheetResolver;

pub(crate) fn convert_data_table_regions(
    output: &ParseOutput,
    resolver: &SheetResolver<'_>,
) -> Vec<DataTableRegionDef> {
    output
        .data_table_regions
        .iter()
        .map(|dt| {
            let sheet_id = resolver
                .by_index(dt.sheet_index as usize)
                .unwrap_or_default()
                .to_string();

            DataTableRegionDef {
                sheet: sheet_id,
                start_row: dt.start_row,
                start_col: dt.start_col,
                end_row: dt.end_row,
                end_col: dt.end_col,
                row_input_ref: dt.row_input_ref,
                col_input_ref: dt.col_input_ref,
                ooxml_flags: dt.ooxml_flags.clone().map(|flags| {
                    snapshot_types::DataTableOoxmlFlags {
                        r1: flags.r1,
                        r2: flags.r2,
                        aca: flags.aca,
                        ca: flags.ca,
                        bx: flags.bx,
                        dt2d: flags.dt2d,
                        dtr: flags.dtr,
                        del1: flags.del1,
                        del2: flags.del2,
                    }
                }),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    //! Typed data-table input refs: regression tests for `convert_data_table_regions`.
    //!
    //! With both sides typed (`Option<CellRef>`), the lowering is a pure
    //! structural copy. These tests pin that contract: the typed identity
    //! flows unchanged from `domain_types::DataTableRegion` to
    //! `snapshot_types::DataTableRegionDef`, with no string round-trip and
    //! no shadow A1 reparse.
    use super::convert_data_table_regions;
    use crate::import::parse_output_to_snapshot::SheetResolver;
    use cell_types::SheetId;
    use domain_types::{DataTableOoxmlFlags, DataTableRegion, ParseOutput};
    use formula_types::CellRef;
    use snapshot_types::SheetSnapshot;

    fn make_output(region: DataTableRegion) -> ParseOutput {
        ParseOutput {
            data_table_regions: vec![region],
            ..Default::default()
        }
    }

    fn resolver_sheets() -> Vec<SheetSnapshot> {
        vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }]
    }

    #[test]
    fn typed_cell_ref_flows_through_unchanged() {
        let row_input = CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        };
        let col_input = CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 5,
            col: 2,
        };
        let output = make_output(DataTableRegion {
            sheet_index: 0,
            start_row: 1,
            start_col: 1,
            end_row: 5,
            end_col: 5,
            row_input_ref: Some(row_input),
            col_input_ref: Some(col_input),
            ooxml_flags: None,
        });
        let sheets = resolver_sheets();
        let regions = convert_data_table_regions(&output, &SheetResolver::new(&sheets));
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].row_input_ref, Some(row_input));
        assert_eq!(regions[0].col_input_ref, Some(col_input));
    }

    #[test]
    fn none_input_flows_through_unchanged() {
        // The `#REF!` / missing case: parser-side classifier returns None,
        // lowering preserves it, scheduler skips the entry. This is the
        // semantic that pre-W4.b's `is_broken_cell_ref` filter delivered.
        let output = make_output(DataTableRegion {
            sheet_index: 0,
            start_row: 1,
            start_col: 1,
            end_row: 5,
            end_col: 5,
            row_input_ref: None,
            col_input_ref: None,
            ooxml_flags: None,
        });
        let sheets = resolver_sheets();
        let regions = convert_data_table_regions(&output, &SheetResolver::new(&sheets));
        assert_eq!(regions.len(), 1);
        assert!(regions[0].row_input_ref.is_none());
        assert!(regions[0].col_input_ref.is_none());
    }

    #[test]
    fn ooxml_flags_flow_through_sidecar() {
        let output = make_output(DataTableRegion {
            sheet_index: 0,
            start_row: 1,
            start_col: 1,
            end_row: 5,
            end_col: 5,
            row_input_ref: None,
            col_input_ref: None,
            ooxml_flags: Some(DataTableOoxmlFlags {
                r1: Some("C8".to_string()),
                r2: Some("C21".to_string()),
                aca: true,
                ca: true,
                bx: true,
                dt2d: true,
                dtr: true,
                del1: true,
                del2: true,
            }),
        });
        let sheets = resolver_sheets();
        let regions = convert_data_table_regions(&output, &SheetResolver::new(&sheets));
        let flags = regions[0]
            .ooxml_flags
            .as_ref()
            .expect("OOXML data-table flags should lower to snapshot sidecar");

        assert!(flags.aca);
        assert!(flags.ca);
        assert!(flags.bx);
        assert!(flags.dt2d);
        assert!(flags.dtr);
        assert!(flags.del1);
        assert!(flags.del2);
        assert_eq!(flags.r1.as_deref(), Some("C8"));
        assert_eq!(flags.r2.as_deref(), Some("C21"));
    }
}
