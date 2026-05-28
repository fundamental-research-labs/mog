use bridge_ts::emit::*;
use bridge_ts::types::*;

#[test]
fn emit_interface_simple() {
    let iface = TsInterface {
        name: "ColWidth".into(),
        fields: vec![
            TsField {
                ts_name: "col".into(),
                ts_type: TsType::Number,
                optional: false,
            },
            TsField {
                ts_name: "width".into(),
                ts_type: TsType::Number,
                optional: false,
            },
            TsField {
                ts_name: "customWidth".into(),
                ts_type: TsType::Boolean,
                optional: true,
            },
            TsField {
                ts_name: "hidden".into(),
                ts_type: TsType::Boolean,
                optional: true,
            },
        ],
    };
    let ts = emit_interface(&iface);
    assert!(ts.contains("export interface ColWidth {"));
    assert!(ts.contains("  col: number;"));
    assert!(ts.contains("  width: number;"));
    assert!(ts.contains("  customWidth?: boolean;"));
    assert!(ts.contains("  hidden?: boolean;"));
    assert!(ts.ends_with("}\n"));
}

#[test]
fn emit_string_union_basic() {
    let union = TsStringUnion {
        name: "Axis".into(),
        variants: vec!["row".into(), "col".into()],
    };
    let ts = emit_string_union(&union);
    assert_eq!(ts, "export type Axis = \"row\" | \"col\";\n");
}

#[test]
fn emit_tagged_union_external() {
    let union = TsTaggedUnion {
        name: "IdentityFormulaRef".into(),
        tag_style: TagStyle::External,
        variants: vec![
            TsTaggedVariant {
                variant_name: "Cell".into(),
                data_type: TsType::Named("IdentityCellRef".into()),
            },
            TsTaggedVariant {
                variant_name: "Range".into(),
                data_type: TsType::Named("IdentityRangeRef".into()),
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("export type IdentityFormulaRef =\n"));
    assert!(ts.contains("  | { Cell: IdentityCellRef }\n"));
    assert!(ts.contains("  | { Range: IdentityRangeRef };\n"));
}

#[test]
fn emit_tagged_union_adjacent() {
    let union = TsTaggedUnion {
        name: "CellValue".into(),
        tag_style: TagStyle::Adjacent {
            tag: "type".into(),
            content: "value".into(),
        },
        variants: vec![
            TsTaggedVariant {
                variant_name: "Number".into(),
                data_type: TsType::Number,
            },
            TsTaggedVariant {
                variant_name: "Text".into(),
                data_type: TsType::String,
            },
            TsTaggedVariant {
                variant_name: "Null".into(),
                data_type: TsType::Void,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("export type CellValue =\n"));
    assert!(ts.contains("  | { type: \"Number\"; value: number }\n"));
    assert!(ts.contains("  | { type: \"Text\"; value: string }\n"));
    // Unit variant (Void) should omit the content field
    assert!(ts.contains("  | { type: \"Null\" };\n"));
    assert!(!ts.contains("\"Null\"; value"));
}

#[test]
fn emit_tagged_union_adjacent_all_unit() {
    let union = TsTaggedUnion {
        name: "Direction".into(),
        tag_style: TagStyle::Adjacent {
            tag: "kind".into(),
            content: "data".into(),
        },
        variants: vec![
            TsTaggedVariant {
                variant_name: "Up".into(),
                data_type: TsType::Void,
            },
            TsTaggedVariant {
                variant_name: "Down".into(),
                data_type: TsType::Void,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("{ kind: \"Up\" }"));
    assert!(ts.contains("{ kind: \"Down\" }"));
    // No content field for any variant
    assert!(!ts.contains("data"));
}

#[test]
fn emit_tagged_union_untagged() {
    let union = TsTaggedUnion {
        name: "Value".into(),
        tag_style: TagStyle::Untagged,
        variants: vec![
            TsTaggedVariant {
                variant_name: "Num".into(),
                data_type: TsType::Number,
            },
            TsTaggedVariant {
                variant_name: "Str".into(),
                data_type: TsType::String,
            },
            TsTaggedVariant {
                variant_name: "Bool".into(),
                data_type: TsType::Boolean,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert_eq!(ts, "export type Value = number | string | boolean;\n");
}

#[test]
fn emit_type_defs_sorted() {
    let defs = vec![
        TsTypeDef::StringUnion(TsStringUnion {
            name: "Zebra".into(),
            variants: vec!["a".into()],
        }),
        TsTypeDef::StringUnion(TsStringUnion {
            name: "Alpha".into(),
            variants: vec!["x".into()],
        }),
    ];
    let ts = emit_type_defs(&defs, None);
    let alpha_pos = ts.find("Alpha").unwrap();
    let zebra_pos = ts.find("Zebra").unwrap();
    assert!(
        alpha_pos < zebra_pos,
        "Alpha should appear before Zebra (alphabetical order)"
    );
}

#[test]
fn emit_type_defs_preamble() {
    let defs = vec![TsTypeDef::Interface(TsInterface {
        name: "Foo".into(),
        fields: vec![TsField {
            ts_name: "bar".into(),
            ts_type: TsType::Named("ExternalThing".into()),
            optional: false,
        }],
    })];
    let ts = emit_type_defs(&defs, None);
    assert!(ts.starts_with("// Auto-generated by bridge-ts. Do not edit.\n"));
    assert!(
        ts.contains("// External types: ExternalThing"),
        "should list external (undefined) Named types"
    );
    assert!(ts.contains("export interface Foo {"));
}

#[test]
fn emit_type_alias_string() {
    let ts = emit_type_alias("SheetId", &TsType::String);
    assert_eq!(ts, "export type SheetId = string;\n");
}

#[test]
fn emit_type_alias_number() {
    let ts = emit_type_alias("Score", &TsType::Number);
    assert_eq!(ts, "export type Score = number;\n");
}

#[test]
fn emit_type_def_type_alias() {
    let def = TsTypeDef::TypeAlias {
        name: "CellId".into(),
        target: TsType::String,
    };
    let ts = emit_type_def(&def);
    assert_eq!(ts, "export type CellId = string;\n");
}

// ─── Bridge Emitter Tests ─────────────────────────────────────────────

#[test]
fn emit_type_defs_includes_type_alias() {
    let defs = vec![
        TsTypeDef::TypeAlias {
            name: "SheetId".into(),
            target: TsType::String,
        },
        TsTypeDef::Interface(TsInterface {
            name: "Foo".into(),
            fields: vec![TsField {
                ts_name: "sheet".into(),
                ts_type: TsType::Named("SheetId".into()),
                optional: false,
            }],
        }),
    ];
    let ts = emit_type_defs(&defs, None);
    // SheetId is defined in defs, so it should NOT appear as external
    assert!(!ts.contains("// External types:"));
    assert!(ts.contains("export type SheetId = string;"));
    assert!(ts.contains("export interface Foo {"));
}
