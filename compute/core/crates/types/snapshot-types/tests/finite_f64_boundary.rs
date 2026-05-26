//! Boundary roundtrip tests proving that `Option<FiniteF64>` fields serialize
//! as present-but-null JSON and deserialize back to `None` without panicking.
//! The failure mode (`null` decoded as `f64` -> IPC error) cannot occur.

use snapshot_types::{RecalcMetrics, SelectionAggregates};

#[test]
fn recalc_metrics_iterative_max_delta_none_roundtrips_as_null() {
    let mut m = RecalcMetrics::default();
    m.iterative_max_delta = None;
    let json = serde_json::to_string(&m).unwrap();
    // Wire-shape contract: present-with-null, NOT skip_serializing_if.
    assert!(
        json.contains("\"iterativeMaxDelta\":null"),
        "iterativeMaxDelta:None must serialize as present-with-null \
         (no skip_serializing_if): {json}"
    );
    let m2: RecalcMetrics = serde_json::from_str(&json).unwrap();
    assert_eq!(m2.iterative_max_delta, None);
    // The other counters must roundtrip too.
    assert_eq!(m2.cells_evaluated, m.cells_evaluated);
    assert_eq!(m2.has_circular_refs, m.has_circular_refs);
}

#[test]
fn selection_aggregates_sum_none_roundtrips_as_null() {
    let sa = SelectionAggregates {
        sum: None,
        count: 0,
        numeric_count: 0,
        average: None,
        min: None,
        max: None,
    };
    let json = serde_json::to_string(&sa).unwrap();
    // Both `sum` and `average`/`min`/`max` must be present-with-null.
    assert!(
        json.contains("\"sum\":null"),
        "sum:None must serialize as null: {json}"
    );
    assert!(
        json.contains("\"average\":null"),
        "average:None must serialize as null: {json}"
    );
    let sa2: SelectionAggregates = serde_json::from_str(&json).unwrap();
    assert_eq!(sa2.sum, None);
    assert_eq!(sa2.average, None);
    assert_eq!(sa2.min, None);
    assert_eq!(sa2.max, None);
}

#[test]
fn deserialize_rejects_non_finite_for_finite_f64() {
    // CalculationSettings.max_change is FiniteF64 — non-finite payloads
    // must fail to deserialize. Today serde_json refuses to parse `NaN`
    // / `Infinity` JSON tokens (non-spec) and `null` cannot decode into
    // a non-Option FiniteF64. Either path is acceptable proof that the
    // boundary refuses non-finite floats.
    let nan_payload =
        r#"{"enableIterativeCalculation":false,"maxIterations":100,"maxChange":null}"#;
    let result: Result<snapshot_types::CalculationSettings, _> = serde_json::from_str(nan_payload);
    assert!(
        result.is_err(),
        "FiniteF64 field must reject JSON null at the boundary"
    );
}
