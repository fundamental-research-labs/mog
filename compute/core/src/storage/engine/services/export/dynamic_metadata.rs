//! Dynamic-array metadata is assigned after all sheets have been materialized,
//! so imported metadata indexes remain stable and new sources share records.
use domain_types::{
    CellMetadataBlock, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup,
    ImportedCellProjectionRole, MetadataType, ParseOutput, WorkbookMetadata,
};

const DYNAMIC_PROPERTIES: &str = "<extLst><ext uri=\"{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}\"><xda:dynamicArrayProperties xmlns:xda=\"http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray\" fDynamic=\"1\" fCollapsed=\"0\"/></ext></extLst>";

pub(super) fn reconcile(output: &mut ParseOutput) {
    let has_dynamic = output
        .sheets
        .iter()
        .flat_map(|sheet| &sheet.cells)
        .any(|cell| cell.projection_role == ImportedCellProjectionRole::DynamicArraySource);
    if !has_dynamic && output.metadata.is_none() {
        return;
    }
    let metadata = output
        .metadata
        .get_or_insert_with(WorkbookMetadata::default);
    let mut dynamic_type = metadata
        .metadata_types
        .iter()
        .position(|ty| ty.name.eq_ignore_ascii_case("XLDAPR"))
        .map(|index| index as u32 + 1);
    let mut generated_record = None;
    for cell in output.sheets.iter_mut().flat_map(|sheet| &mut sheet.cells) {
        let mut records = cell
            .cell_metadata_index
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| metadata.cell_metadata.get(index as usize))
            .map(|block| block.records.clone())
            .unwrap_or_default();
        if cell.projection_role == ImportedCellProjectionRole::DynamicArraySource {
            // Retain imported records verbatim. Allocate only when a new
            // source lacks XLDAPR; unchanged workbooks keep raw XML replay.
            if !records.iter().any(|record| Some(record.t) == dynamic_type) {
                let record = generated_record.get_or_insert_with(|| dynamic_record(metadata));
                dynamic_type = Some(record.t);
                records.push(record.clone());
            } else {
                continue;
            }
        } else if records.iter().any(|record| Some(record.t) == dynamic_type) {
            // Formula/value edits can remove the array source while retaining
            // unrelated cell metadata. Do not leave a stale dynamic marker.
            records.retain(|record| Some(record.t) != dynamic_type);
        } else {
            continue;
        }
        if records.is_empty() {
            cell.cell_metadata_index = None;
            continue;
        }
        let index = metadata
            .cell_metadata
            .iter()
            .position(|block| block.records == records)
            .unwrap_or_else(|| {
                metadata.cell_metadata.push(CellMetadataBlock { records });
                metadata.cell_metadata.len() - 1
            });
        cell.cell_metadata_index = Some(index as u32 + 1);
    }
}

fn dynamic_record(metadata: &mut WorkbookMetadata) -> CellMetadataRecord {
    let type_index = metadata
        .metadata_types
        .iter()
        .position(|ty| ty.name.eq_ignore_ascii_case("XLDAPR"))
        .unwrap_or_else(|| {
            metadata.metadata_types.push(MetadataType {
                name: "XLDAPR".into(),
                min_supported_version: 120000,
                copy: true,
                paste_all: true,
                paste_values: true,
                merge: true,
                split_first: true,
                row_col_shift: true,
                clear_formats: true,
                clear_comments: true,
                assign: true,
                coerce: true,
                cell_meta: true,
                ..Default::default()
            });
            metadata.metadata_types.len() - 1
        });
    let group_index = metadata
        .future_metadata
        .iter()
        .position(|group| group.name.eq_ignore_ascii_case("XLDAPR"))
        .unwrap_or_else(|| {
            metadata.future_metadata.push(FutureMetadataGroup {
                name: "XLDAPR".into(),
                blocks: Vec::new(),
            });
            metadata.future_metadata.len() - 1
        });
    let group = &mut metadata.future_metadata[group_index];
    // Reuse a known generated block. Unknown imported extension attributes are
    // not guessed at; append our block without changing their indexes.
    let block_index = group
        .blocks
        .iter()
        .position(|block| block.raw_xml == DYNAMIC_PROPERTIES)
        .unwrap_or_else(|| {
            group.blocks.push(FutureMetadataBlock {
                raw_xml: DYNAMIC_PROPERTIES.into(),
            });
            group.blocks.len() - 1
        });
    CellMetadataRecord {
        t: type_index as u32 + 1,
        v: block_index as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adding_dynamic_sources_preserves_other_metadata_and_reuses_indexes() {
        let mut output = ParseOutput {
            metadata: Some(WorkbookMetadata {
                metadata_types: vec![MetadataType {
                    name: "VENDOR".into(),
                    ..Default::default()
                }],
                cell_metadata: vec![CellMetadataBlock {
                    records: vec![CellMetadataRecord { t: 1, v: 7 }],
                }],
                ..Default::default()
            }),
            sheets: vec![domain_types::SheetData {
                cells: vec![
                    domain_types::CellData {
                        cell_metadata_index: Some(1),
                        projection_role: ImportedCellProjectionRole::DynamicArraySource,
                        ..Default::default()
                    },
                    domain_types::CellData {
                        projection_role: ImportedCellProjectionRole::DynamicArraySource,
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        reconcile(&mut output);
        let metadata = output.metadata.as_ref().unwrap();
        assert_eq!(
            metadata.cell_metadata[0].records[0],
            CellMetadataRecord { t: 1, v: 7 }
        );
        assert_eq!(
            metadata.cell_metadata[1].records,
            vec![
                CellMetadataRecord { t: 1, v: 7 },
                CellMetadataRecord { t: 2, v: 0 }
            ]
        );
        let once = output.clone();
        reconcile(&mut output);
        assert_eq!(output, once);
        // Replacing an array with a scalar must remove only its dynamic
        // record; vendor metadata keeps its original stable block index.
        for cell in &mut output.sheets[0].cells {
            cell.projection_role = ImportedCellProjectionRole::Normal;
        }
        reconcile(&mut output);
        assert_eq!(output.sheets[0].cells[0].cell_metadata_index, Some(1));
        assert_eq!(output.sheets[0].cells[1].cell_metadata_index, None);
    }
}
