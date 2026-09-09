use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::ComputeEngine;
use domain_types::{ParseOutput, SheetData};
use snapshot_types::{ScenarioApplyResult, ScenarioCreateInput, ScenarioCreateResult};
use value_types::{CellValue, FiniteF64};

#[test]
fn native_scenario_apply_and_restore_preserve_formulas_after_definition_removal() {
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Inputs".into(),
            rows: 5,
            cols: 3,
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).unwrap();
    engine.set_cell_value_parsed(&sheet, 0, 0, "=2+3").unwrap();
    engine.set_cell_value_parsed(&sheet, 0, 1, "=A1*2").unwrap();
    let input = engine
        .mirror()
        .get_sheet(&sheet)
        .unwrap()
        .cell_id_at(SheetPos::new(0, 0))
        .unwrap();
    let (_, result) = engine
        .create_scenario(ScenarioCreateInput {
            name: "Higher input".into(),
            comment: "Native scenario".into(),
            changing_cells: vec![input.to_uuid_string()],
            values: vec![CellValue::Number(FiniteF64::must(10.0))],
            created_by: None,
        })
        .unwrap();
    let created: ScenarioCreateResult = serde_json::from_value(result.data.unwrap()).unwrap();
    assert!(created.success);
    let scenario = created.scenario_id.unwrap();
    let (_, result) = engine.apply_scenario(&scenario).unwrap();
    let applied: ScenarioApplyResult = serde_json::from_value(result.data.unwrap()).unwrap();
    assert!(applied.success);
    assert_eq!(applied.cells_updated, 1);
    assert_eq!(engine.get_raw_value(&sheet, 0, 0), "10");
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet, SheetPos::new(0, 1)),
        Some(&CellValue::Number(FiniteF64::must(20.0)))
    );
    let baseline = engine.get_active_scenario_state().unwrap().baseline_id;
    engine.remove_scenario(&scenario).unwrap();
    assert!(engine.get_all_scenarios().is_empty());
    assert!(engine.get_active_scenario_state().is_some());
    engine.restore_scenario(&baseline).unwrap();
    assert_eq!(engine.get_raw_value(&sheet, 0, 0), "=2+3");
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet, SheetPos::new(0, 1)),
        Some(&CellValue::Number(FiniteF64::must(10.0)))
    );
    assert!(engine.get_active_scenario_state().is_none());
    let (restored, _) =
        ComputeEngine::from_xlsx_bytes(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    let sheet = SheetId::from_uuid_str(&restored.get_all_sheet_ids()[0]).unwrap();
    assert_eq!(restored.get_raw_value(&sheet, 0, 0), "=2+3");
}
