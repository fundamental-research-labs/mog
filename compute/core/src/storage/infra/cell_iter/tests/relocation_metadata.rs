use super::{cell_property_exists, make_sheet_id, seed_cell, set_cell_property};
use crate::storage::{CellMetadata, FormulaMetadata, WorkbookStorage};
use cell_types::{IdAllocator, RangePos};
use compute_document::identity::GridIndex;
use ooxml_types::worksheet::{CellFormula, CellFormulaType};
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn cross_sheet_relocate_preserves_structured_cell_metadata_and_properties() {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let source = make_sheet_id(1);
    let target = make_sheet_id(2);
    storage
        .add_sheet(&mut mirror, source, "Source", 100, 26)
        .unwrap();
    storage
        .add_sheet(&mut mirror, target, "Target", 100, 26)
        .unwrap();
    let mut source_grid = GridIndex::new(source, 100, 26, Arc::new(IdAllocator::new()));
    let mut target_grid = GridIndex::new(target, 100, 26, Arc::new(IdAllocator::new()));
    let id = seed_cell(&storage, source, &mut source_grid, 0, 0, CellValue::Null);
    set_cell_property(&mut storage, source, id, r#"{"format":{"bold":true}}"#);
    storage.set_cell_metadata(
        id,
        CellMetadata {
            formula: Some(FormulaMetadata::from(&CellFormula {
                ca: true,
                ..Default::default()
            })),
            array_ref: Some("A1:B2".into()),
            ..Default::default()
        },
    );
    let result = super::super::relocate_cells(
        &mut storage,
        source,
        &RangePos::new(source, 0, 0, 0, 0),
        target,
        4,
        5,
        &mut source_grid,
        Some(&mut target_grid),
    );
    assert!(result.success);
    assert_eq!(target_grid.cell_id_at(4, 5), Some(id));
    assert!(source_grid.cell_id_at(0, 0).is_none());
    let metadata = storage.cell_metadata(&id).unwrap();
    assert!(metadata.formula.as_ref().unwrap().ca);
    assert!(metadata.array_ref.is_none());
    assert!(cell_property_exists(&storage, target, id));
    assert!(!cell_property_exists(&storage, source, id));
}

#[test]
fn complete_shared_family_translates_but_partial_family_loses_markers() {
    for end_row in [0, 1] {
        let (mut storage, sheet, mut grid) = super::storage_with_grid();
        let anchor = grid.ensure_cell_id(0, 0);
        let follower = grid.ensure_cell_id(1, 0);
        for (id, range) in [(anchor, Some("A1:A2".into())), (follower, None)] {
            storage.set_cell_metadata(
                id,
                CellMetadata {
                    formula: Some(FormulaMetadata::from(&CellFormula {
                        t: CellFormulaType::Shared,
                        si: Some(3),
                        r#ref: range,
                        ..Default::default()
                    })),
                    ..Default::default()
                },
            );
        }
        super::super::relocate_cells(
            &mut storage,
            sheet,
            &RangePos::new(sheet, 0, 0, end_row, 0),
            sheet,
            4,
            2,
            &mut grid,
            None,
        );
        if end_row == 1 {
            assert_eq!(
                storage
                    .cell_metadata(&anchor)
                    .unwrap()
                    .formula
                    .as_ref()
                    .unwrap()
                    .r#ref
                    .as_deref(),
                Some("C5:C6")
            );
            assert_eq!(
                storage
                    .cell_metadata(&follower)
                    .unwrap()
                    .formula
                    .as_ref()
                    .unwrap()
                    .si,
                Some(3)
            );
        } else {
            assert!(storage.cell_metadata(&anchor).is_none());
        }
    }
}
