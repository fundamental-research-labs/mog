use super::super::*;
use super::helpers::*;
use value_types::ComputeError;

fn assert_reserved(engine: &mut ComputeEngine) {
    for row in 0..3 {
        assert!(matches!(
            engine.set_cell_value_parsed(&sheet_id(), row, 3, "42"),
            Err(ComputeError::PartialArrayWrite { .. })
        ));
    }
}

#[test]
fn replay_keeps_cse_selection_larger_than_scalar_or_array_result() {
    for formula in ["=1", "=SEQUENCE(2)"] {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        engine
            .set_array_formula(&sheet_id(), 0, 3, 2, 3, formula.to_owned())
            .unwrap();
        assert_reserved(&mut engine);
        engine
            .clear_range_by_position(sheet_id(), 0, 3, 2, 3)
            .unwrap();
        for _ in 0..3 {
            engine.undo().unwrap();
            assert_reserved(&mut engine);
            engine.redo().unwrap();
        }
        engine.undo().unwrap();
        engine.undo().unwrap();
        engine.redo().unwrap();
        assert_reserved(&mut engine);
        engine.create_sheet("Other").unwrap();
        engine.undo().unwrap();
        assert_reserved(&mut engine);
        engine.redo().unwrap();
        engine.delete_sheet(&sheet_id()).unwrap();
        engine.undo().unwrap();
        assert_reserved(&mut engine);
    }
}
