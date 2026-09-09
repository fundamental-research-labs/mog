//! Position-normalized native XLSX state for hydration parity tests.

use std::collections::BTreeMap;

use crate::storage::engine::ComputeEngine;
use domain_types::MergeRegion;
use domain_types::domain::hyperlink::Hyperlink;
use value_types::CellValue;

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalCell {
    pub value: CellValue,
    pub formula: Option<String>,
    pub array_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalSheet {
    pub cells: BTreeMap<(u32, u32), CanonicalCell>,
    pub merges: Vec<MergeRegion>,
    pub hyperlinks: Vec<Hyperlink>,
}

/// Compare authored cell content and anchored features through the production
/// export projection. Fresh IDs and package relationship hints are normalized.
pub fn canonicalize(engine: &ComputeEngine) -> BTreeMap<String, CanonicalSheet> {
    let output = engine
        .export_to_parse_output()
        .expect("native export")
        .parse_output;
    output
        .sheets
        .into_iter()
        .map(|mut sheet| {
            let cells = sheet
                .cells
                .into_iter()
                .filter(|cell| !matches!(cell.value, CellValue::Null) || cell.formula.is_some())
                .map(|cell| {
                    (
                        (cell.row, cell.col),
                        CanonicalCell {
                            value: cell.value,
                            formula: cell.formula.map(|source| {
                                source.strip_prefix('=').unwrap_or(&source).to_owned()
                            }),
                            array_ref: cell.array_ref,
                        },
                    )
                })
                .collect();
            sheet.merges.sort_by_key(|merge| {
                (
                    merge.start_row,
                    merge.start_col,
                    merge.end_row,
                    merge.end_col,
                )
            });
            for link in &mut sheet.hyperlinks {
                link.uid = None;
                link.target_kind = None;
                link.target_mode = None;
            }
            sheet
                .hyperlinks
                .sort_by(|left, right| left.cell_ref.cmp(&right.cell_ref));
            (
                sheet.name,
                CanonicalSheet {
                    cells,
                    merges: sheet.merges,
                    hyperlinks: sheet.hyperlinks,
                },
            )
        })
        .collect()
}
