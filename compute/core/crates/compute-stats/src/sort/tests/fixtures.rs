use value_types::CellValue;

pub(super) fn number_values(values: &[f64]) -> Vec<CellValue> {
    values
        .iter()
        .map(|value| CellValue::number(*value))
        .collect()
}

pub(super) fn text_values(values: &[&str]) -> Vec<CellValue> {
    values
        .iter()
        .map(|value| CellValue::Text((*value).into()))
        .collect()
}

pub(super) fn texts(values: &[CellValue]) -> Vec<&str> {
    values
        .iter()
        .map(|value| match value {
            CellValue::Text(text) => &**text,
            _ => panic!("expected text"),
        })
        .collect()
}

pub(super) fn numbers(values: &[CellValue]) -> Vec<f64> {
    values
        .iter()
        .map(|value| match value {
            CellValue::Number(number) => number.get(),
            _ => panic!("expected number"),
        })
        .collect()
}

pub(super) fn assert_blank_suffix(values: &[CellValue], start_index: usize) {
    for value in &values[start_index..] {
        assert!(
            matches!(value, CellValue::Null)
                || matches!(value, CellValue::Text(text) if text.trim().is_empty()),
            "expected blank, got {value:?}"
        );
    }
}

pub(super) fn mixed_values_for_sort_path_parity() -> Vec<CellValue> {
    vec![
        CellValue::Text("Item 10".into()),
        CellValue::Text("item 2".into()),
        CellValue::Null,
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::Text("".into()),
        CellValue::Text("  ".into()),
        CellValue::Boolean(false),
        CellValue::Error(value_types::CellError::Div0, None),
    ]
}
