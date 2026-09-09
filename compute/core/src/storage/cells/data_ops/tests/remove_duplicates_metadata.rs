use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::engine::ComputeEngine;
use crate::storage::{CellMetadata, FormulaMetadata};
use cell_types::{CellId, SheetId};
use ooxml_types::worksheet::{CellFormula, CellFormulaType};
use value_types::CellValue;

#[test]
fn remove_duplicates_transfers_metadata_and_invalidates_coordinate_markers() {
    for kind in [
        CellFormulaType::Normal,
        CellFormulaType::Shared,
        CellFormulaType::Array,
        CellFormulaType::DataTable,
    ] {
        let sheet = SheetId::from_raw(1);
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet.to_uuid_string(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 2,
                cells: ["A", "A", "C"]
                    .iter()
                    .enumerate()
                    .map(|(row, value)| CellData {
                        cell_id: CellId::from_raw(row as u128 + 10).to_uuid_string(),
                        row: row as u32,
                        col: 0,
                        value: CellValue::from(*value),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    })
                    .collect(),
                identities: vec![],
                row_axis: None,
                col_axis: None,
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
        let source = CellId::from_raw(12);
        engine.storage_mut().set_cell_metadata(
            source,
            CellMetadata {
                formula: Some(FormulaMetadata::from(&CellFormula {
                    t: kind.clone(),
                    ca: true,
                    si: Some(8),
                    r#ref: Some("A3:A3".into()),
                    ..Default::default()
                })),
                array_ref: Some("A3:B3".into()),
                ..Default::default()
            },
        );
        engine.clear_history();
        engine
            .remove_duplicates(&sheet, 0, 0, 2, 0, vec![], false)
            .unwrap();
        assert_eq!(engine.get_cell_value(&sheet, 1, 0), CellValue::from("C"));
        let target = CellId::from_uuid_str(&engine.get_cell_id_at(&sheet, 1, 0).unwrap()).unwrap();
        let metadata = engine.storage().cell_metadata(&target);
        assert!(metadata.is_none_or(|metadata| metadata.array_ref.is_none()));
        assert_eq!(
            metadata.is_some_and(|metadata| metadata
                .formula
                .as_ref()
                .is_some_and(|formula| formula.ca)),
            kind == CellFormulaType::Normal
        );
        engine.undo().unwrap();
        assert!(
            engine
                .storage()
                .cell_metadata(&source)
                .unwrap()
                .array_ref
                .is_some()
        );
        assert_eq!(engine.get_cell_value(&sheet, 2, 0), CellValue::from("C"));
    }
}
