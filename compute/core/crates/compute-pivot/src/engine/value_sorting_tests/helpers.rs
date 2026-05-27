use super::*;

/// Helper: shared data for column_key tests.
pub(super) fn column_key_test_data() -> (Vec<Vec<CellValue>>, Vec<PivotField>) {
    let data = vec![
        vec![cv_text("BU"), cv_text("Year"), cv_text("Amount")],
        // Alpha: FY2022=100, FY2024=50 (smallest in 2024, middle in 2022)
        vec![cv_text("Alpha"), cv_text("2022"), cv_num(100.0)],
        vec![cv_text("Alpha"), cv_text("2023"), cv_num(500.0)],
        vec![cv_text("Alpha"), cv_text("2024"), cv_num(50.0)],
        // Beta: FY2022=200, FY2024=300 (largest in 2024, middle in 2022)
        vec![cv_text("Beta"), cv_text("2022"), cv_num(200.0)],
        vec![cv_text("Beta"), cv_text("2023"), cv_num(100.0)],
        vec![cv_text("Beta"), cv_text("2024"), cv_num(300.0)],
        // Gamma: FY2022=300, FY2024=150 (middle in 2024, largest in 2022)
        vec![cv_text("Gamma"), cv_text("2022"), cv_num(300.0)],
        vec![cv_text("Gamma"), cv_text("2023"), cv_num(200.0)],
        vec![cv_text("Gamma"), cv_text("2024"), cv_num(150.0)],
    ];
    let fields = vec![
        PivotField {
            id: FieldId::from("bu"),
            name: "BU".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("year"),
            name: "Year".into(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];
    (data, fields)
}
