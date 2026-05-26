//! B.2 — confirm that `AccessTarget` (compute-security's tagged enum) parses
//! through `bridge_ts::parse_types` as a `TsTaggedUnion` with the expected
//! internal-tag wire shape. This guards the "TS already works" claim in the
//! B.2 plan: the NAPI/PyO3 codegens were extended, but bridge-ts was
//! intentionally left alone — this test makes sure that assumption holds.

use bridge_ts::types::{TagStyle, TsType, TsTypeDef};
use bridge_ts::{TypeGenConfig, parse_types};

const ACCESS_TARGET_SOURCE: &str = r#"
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccessTarget {
    Workbook,
    Sheet { sheet_id: String },
    Column { sheet_id: String, col_id: String },
}
"#;

#[test]
fn access_target_emits_tagged_union_with_internal_kind() {
    let defs =
        parse_types(ACCESS_TARGET_SOURCE, &TypeGenConfig::default()).expect("parse succeeds");

    // Struct-variant enums emit helper interfaces for each non-unit variant
    // plus a single tagged-union def — so there's one TaggedUnion named
    // AccessTarget among the defs.
    let tagged_union = defs
        .iter()
        .find_map(|d| match d {
            TsTypeDef::TaggedUnion(tu) if tu.name == "AccessTarget" => Some(tu),
            _ => None,
        })
        .expect("AccessTarget TaggedUnion present");

    match &tagged_union.tag_style {
        TagStyle::Internal { tag } => assert_eq!(tag, "kind"),
        other => panic!("expected internal tag 'kind', got {:?}", other),
    }

    let variant_names: Vec<&str> = tagged_union
        .variants
        .iter()
        .map(|v| v.variant_name.as_str())
        .collect();
    assert_eq!(variant_names, vec!["workbook", "sheet", "column"]);

    // Workbook has no fields → TsType::Void.
    assert_eq!(tagged_union.variants[0].data_type, TsType::Void);

    // Sheet and Column reference helper interfaces named `AccessTarget_<variant>`.
    assert_eq!(
        tagged_union.variants[1].data_type,
        TsType::Named("AccessTarget_sheet".to_string())
    );
    assert_eq!(
        tagged_union.variants[2].data_type,
        TsType::Named("AccessTarget_column".to_string())
    );
}

#[test]
fn access_target_helper_interfaces_carry_fields() {
    let defs =
        parse_types(ACCESS_TARGET_SOURCE, &TypeGenConfig::default()).expect("parse succeeds");

    let sheet_iface = defs
        .iter()
        .find_map(|d| match d {
            TsTypeDef::Interface(i) if i.name == "AccessTarget_sheet" => Some(i),
            _ => None,
        })
        .expect("Sheet helper interface present");
    assert_eq!(sheet_iface.fields.len(), 1);
    assert_eq!(sheet_iface.fields[0].ts_name, "sheet_id");

    let column_iface = defs
        .iter()
        .find_map(|d| match d {
            TsTypeDef::Interface(i) if i.name == "AccessTarget_column" => Some(i),
            _ => None,
        })
        .expect("Column helper interface present");
    let field_names: Vec<&str> = column_iface
        .fields
        .iter()
        .map(|f| f.ts_name.as_str())
        .collect();
    assert_eq!(field_names, vec!["sheet_id", "col_id"]);
}
