use super::*;

// -----------------------------------------------------------------------
// CellInput semantics — typed intent replaces \x00 sentinel
// -----------------------------------------------------------------------

#[test]
fn cell_input_literal_empty_stores_text_not_null() {
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x50); // fresh cell

    // CellInput::Literal("") → CellValue::Text(""), distinct from Null.
    let input = CellInput::Literal {
        text: String::new(),
    };
    core.set_cell(&mut mirror, &sheet_id, cell_id, 5, 0, &input)
        .unwrap();

    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Text("".into()),
        "Literal(\"\") should produce Text(\"\"), not Null"
    );
}

#[test]
fn cell_input_clear_yields_null() {
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x51);

    // First set a value
    core.set_cell(&mut mirror, &sheet_id, cell_id, 6, 0, "hello")
        .unwrap();
    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(*val, CellValue::Text("hello".into()));

    // Now clear with CellInput::Clear
    core.set_cell(&mut mirror, &sheet_id, cell_id, 6, 0, &CellInput::Clear)
        .unwrap();
    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Null,
        "CellInput::Clear should produce Null"
    );
}

#[test]
fn cell_input_parse_nul_is_plain_text() {
    // Regression guard: a single-character NUL string fed through Parse must
    // end up as the literal text "\x00" — not silently re-interpreted as the
    // legacy empty-string sentinel.
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x52);

    let input = CellInput::Parse {
        text: "\x00".to_string(),
    };
    core.set_cell(&mut mirror, &sheet_id, cell_id, 7, 0, &input)
        .unwrap();

    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Text("\x00".into()),
        "Parse(\"\\x00\") must flow through as plain NUL text"
    );
}
