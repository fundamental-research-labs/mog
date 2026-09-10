//! OfficeJS enum values are loaded through the same embedded runtime path as scripts.

use mog::run_office_js;
use serde_json::json;

#[test]
fn generated_excel_enums_have_pinned_values_and_complete_shape() {
    let output = run_office_js(
        r#"
        const enumNames = Object.keys(Excel).filter((name) => Excel[name] && typeof Excel[name] === "object");
        let memberCount = 0;
        for (const name of enumNames) memberCount += Object.keys(Excel[name]).length;
        return {
          enumCount: enumNames.length,
          memberCount,
          horizontal: Excel.HorizontalAlignment,
          calculation: Excel.CalculationMode,
          chartType: {
            invalid: Excel.ChartType.invalid,
            columnClustered: Excel.ChartType.columnClustered,
            _3DColumnClustered: Excel.ChartType._3DColumnClustered,
          },
          clearApplyTo: Excel.ClearApplyTo,
        };
        "#,
    )
    .expect("generated enums should be available in the OfficeJS runtime");

    assert_eq!(
        output.value,
        json!({
            "enumCount": 179,
            "memberCount": 1999,
            "horizontal": {
                "general": "General",
                "left": "Left",
                "center": "Center",
                "right": "Right",
                "fill": "Fill",
                "justify": "Justify",
                "centerAcrossSelection": "CenterAcrossSelection",
                "distributed": "Distributed",
            },
            "calculation": {
                "automatic": "Automatic",
                "automaticExceptTables": "AutomaticExceptTables",
                "manual": "Manual",
            },
            "chartType": {
                "invalid": "Invalid",
                "columnClustered": "ColumnClustered",
                "_3DColumnClustered": "3DColumnClustered",
            },
            "clearApplyTo": {
                "all": "All",
                "formats": "Formats",
                "contents": "Contents",
                "hyperlinks": "Hyperlinks",
                "removeHyperlinks": "RemoveHyperlinks",
                "resetContents": "ResetContents",
            },
        })
    );
}

#[test]
fn enum_installation_keeps_office_extension_runtime_classes() {
    let output = run_office_js(
        r#"
        return {
          clientObject: typeof OfficeExtension.ClientObject,
          requestContext: typeof OfficeExtension.ClientRequestContext,
          error: typeof OfficeExtension.Error,
        };
        "#,
    )
    .expect("OfficeExtension runtime should remain available alongside enum installation");

    assert_eq!(
        output.value,
        json!({
            "clientObject": "function",
            "requestContext": "function",
            "error": "function",
        })
    );
}
