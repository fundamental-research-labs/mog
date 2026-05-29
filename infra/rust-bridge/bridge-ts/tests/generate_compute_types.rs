//! Integration test: generate TypeScript types from snapshot-types source files.
//!
//! Reads real Rust source files from compute/core/crates/types/snapshot-types/
//! and generates TypeScript interfaces, string unions, and tagged unions.

use bridge_ts::{ImportConfig, ImportGroup, TypeGenConfig, TypeImport, generate_types_from_source};
use std::collections::HashMap;

fn compute_config() -> TypeGenConfig {
    let mut map = HashMap::new();
    // Common external types in the compute crate ecosystem
    map.insert("FiniteF64".to_string(), bridge_ts::types::TsType::Number);
    map.insert(
        "serde_json::Value".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    map.insert(
        "Value".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    map.insert("NaiveDate".to_string(), bridge_ts::types::TsType::String);
    map.insert(
        "NaiveDateTime".to_string(),
        bridge_ts::types::TsType::String,
    );
    map.insert("u128".to_string(), bridge_ts::types::TsType::String);
    // Range types from domain_types/ranges.rs (position-based ranges)
    map.insert(
        "PositionRange".to_string(),
        bridge_ts::types::TsType::Named("SheetRange".into()),
    );
    map.insert(
        "CellIdRange".to_string(),
        bridge_ts::types::TsType::Named(
            "{ topLeftCellId: string; bottomRightCellId: string }".into(),
        ),
    );

    // ── Sub-crate cross-crate types ──────────────────────────────────────────

    // value_types::Color — serialized as [u8; 4] RGBA tuple
    map.insert(
        "Color".to_string(),
        bridge_ts::types::TsType::Named("[number, number, number, number]".into()),
    );
    // value_types::CellValue — maps to CellValue from @mog-sdk/contracts/core
    map.insert(
        "CellValue".to_string(),
        bridge_ts::types::TsType::Named("CellValue".into()),
    );
    // cell_types::CellId — serialized as UUID string at IPC boundary
    map.insert("CellId".to_string(), bridge_ts::types::TsType::String);
    // cell_types::SheetId — UUID newtype, serialized as string
    map.insert("SheetId".to_string(), bridge_ts::types::TsType::String);
    // cell_types::RangeId — UUID newtype, serialized as string
    map.insert("RangeId".to_string(), bridge_ts::types::TsType::String);
    // cell_types::RowId — UUID newtype, serialized as string
    map.insert("RowId".to_string(), bridge_ts::types::TsType::String);
    // cell_types::ColId — UUID newtype, serialized as string
    map.insert("ColId".to_string(), bridge_ts::types::TsType::String);
    // cell_types compact axis identity wire helpers. `AxisIdentityRef::{StoreRun,Runs}`
    // references these, but identity.rs is not part of the compute-types source set.
    map.insert("AxisRunId".to_string(), bridge_ts::types::TsType::Number);
    map.insert(
        "AxisIdentityRunRef".to_string(),
        bridge_ts::types::TsType::Named(
            "{ runId: number; startOffset: number; len: number }".into(),
        ),
    );
    for axis_ref_alias in [
        "RowAxisIdentityRef",
        "ColAxisIdentityRef",
        "RowAxisIdentityRefBin",
        "ColAxisIdentityRefBin",
    ] {
        map.insert(
            axis_ref_alias.to_string(),
            bridge_ts::types::TsType::Named("unknown".into()),
        );
    }
    // bridge-ts does not model generic type parameters in `AxisIdentityRef<Id>`;
    // keep the generated boundary opaque rather than importing a phantom `Id`.
    map.insert(
        "Id".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    // TableRange is a type alias for SheetRange in compute-table
    map.insert(
        "TableRange".to_string(),
        bridge_ts::types::TsType::Named("SheetRange".into()),
    );
    // formula_types re-exports used by compute-table (pub use)
    map.insert(
        "SpecialItem".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    map.insert(
        "StructuredRef".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    map.insert(
        "StructuredRefSpecifier".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    // formula_types::CellRef — externally-tagged enum used by data-table input refs
    // in DataTableRegionDef (typed data-table input refs retyped from Option<String> -> Option<CellRef>).
    // Wire form: { "Resolved": <CellId> } | { "Positional": { sheet, row, col } }.
    // Mapped to `unknown` at the TS boundary; consumers of these fields don't
    // exist on the TS side today and the mirror plan does not surface them.
    map.insert(
        "CellRef".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    // ooxml_types::cond_format::CfOperator — referenced by domain-types CF rules.
    // The pre-existing gen file aliases this as TS `CFOperator` (string union).
    // Map the Rust type name (lower-case f) to the existing TS surface.
    map.insert(
        "CfOperator".to_string(),
        bridge_ts::types::TsType::Named("CFOperator".into()),
    );
    // ooxml_types enums referenced by domain-types CF / styles / filter
    // modules. Pre-existing gen file rendered these as `string` (the previous
    // codegen had no mapping and emitted bare `string` via the fallback).
    // Preserve that surface; tightening to the proper TS enums is out of scope
    // for the kernel-state-mirror pass 2 step 1.
    //
    // Note: `BorderStyle` and `UnderlineStyle` here are the *ooxml-types*
    // enums — broader (15 + 5 variants) than the compute-table domain enums
    // of the same name (3 + 4 variants). TypeScript-side, the parser still
    // emits `export type BorderStyle = "thin" | "medium" | "thick"` from
    // compute-table; this mapping only affects how *references* in CF / CFStyle
    // (ooxml-shape) types are emitted (as `string`). The cohabitation is
    // imperfect but matches the wire reality the previous gen file shipped.
    for ooxml_enum in [
        "CfTimePeriod",
        "CfvoType",
        "DataBarAxisPosition",
        "DataBarDirection",
        "IconSetType",
        "BorderStyle",
        "UnderlineStyle",
    ] {
        map.entry(ooxml_enum.to_string())
            .or_insert(bridge_ts::types::TsType::String);
    }

    // Chart round-trip types: defined in chart/round_trip_types.rs but referenced
    // from chart/mod.rs (which is parsed). The round-trip module is intentionally
    // not parsed because it carries OOXML-specific shapes the TS view doesn't use.
    // Pre-existing gen file emitted `unknown` for all of them; preserve that.
    for ooxml_round_trip in [
        "ChartColorMappingOverride",
        "ChartScene3D",
        "ChartShape3D",
        "ChartProtection",
        "ChartTextBody",
        "ChartShapeProperties",
        "ChartExtension",
        "ChartExternalData",
        "ChartManualLayout",
        "ChartPivotSource",
        "ChartPivotFmt",
        "ChartPivotFormat",
        "WaterfallOptions",
        "VmlShapeProps",
        "Shape3DSettings",
        "SceneSettings",
        "PivotRowColItem",
        "PivotFieldItem",
        "PivotFieldFunction",
        "OleObjectProperties",
        "GroupShapeData",
        "ChartPrintSettings",
        "ChartConnector",
        "ChartPicture",
        "ChartShape",
        "ChartCellAnchor",
    ] {
        map.entry(ooxml_round_trip.to_string())
            .or_insert(bridge_ts::types::TsType::Named("unknown".into()));
    }
    // ChartDefinition — tagged enum with ChartSpace/ChartExSpace variants
    map.insert(
        "ChartDefinition".to_string(),
        bridge_ts::types::TsType::Named("unknown".into()),
    );
    // OOXML types from ooxml_types crate — opaque at TS boundary.
    // PrintSettings is intentionally NOT in this list: it collides with
    // domain_types::domain::print::PrintSettings (a real wire shape used by
    // PrintSettingsChange in MutationResult). The ooxml-side PrintSettings is
    // never reached through types parsed by this codegen, so leaving it
    // unmapped is safe; if a Rust source ever references the ooxml version
    // through a parsed type, the codegen will fail loudly.
    for ooxml_type in [
        "CellAnchor",
        "ChartExSpace",
        "ChartProtection",
        "ChartSpace",
        "ChartTypeConfig",
        "ColorMappingOverride",
        "CommentPr",
        "ContentPartRef",
        "DrawingAnchorMetadata",
        "ExtensionEntry",
        "ExternalData",
        "ManualLayout",
        "OpcRelationship",
        "PivotFmt",
        "PivotSource",
        "Scene3D",
        "Shape3D",
        "ShapeProperties",
        "SlicerTabularItem",
        "SpreadsheetConnector",
        "SpreadsheetPicture",
        "SpreadsheetShape",
        "TextBody",
        "XmlColumnPr",
    ] {
        map.insert(
            ooxml_type.to_string(),
            bridge_ts::types::TsType::Named("unknown".into()),
        );
    }
    // ChartType — custom serde serializes as plain string ("bar", "line", etc.)
    map.insert("ChartType".to_string(), bridge_ts::types::TsType::String);
    // ChartSubType — custom serde serializes as plain string ("clustered", "stacked", etc.)
    map.insert("ChartSubType".to_string(), bridge_ts::types::TsType::String);
    // FloatingObject — manual serde flattens common + data, not derive-parseable
    map.insert(
        "FloatingObject".to_string(),
        bridge_ts::types::TsType::Named("FloatingObjectCommon & FloatingObjectData".into()),
    );
    // domain_types::CellFormat — maps to CellFormat from @mog-sdk/contracts/core
    map.insert(
        "CellFormat".to_string(),
        bridge_ts::types::TsType::Named("CellFormat".into()),
    );
    // domain_types::ResolvedCellFormat — dense version of CellFormat (same TS shape)
    map.insert(
        "ResolvedCellFormat".to_string(),
        bridge_ts::types::TsType::Named("CellFormat".into()),
    );
    // domain_types::FontSize — custom serde serializes as f64 points
    map.insert("FontSize".to_string(), bridge_ts::types::TsType::Number);
    map.insert(
        "FormulaCacheProvenance".to_string(),
        bridge_ts::types::TsType::Named(
            "{ state?: \"importedCurrent\" | \"mogComputedCurrent\" | \"staleImported\" | \"absentOrUnknown\"; forceRecalc?: boolean; advancedCalc?: boolean; formulaPreserveSpace?: boolean; valuePreserveSpace?: boolean; cachedValueKind?: number; cachedValuePresence?: \"absent\" | \"explicitEmpty\" | \"nonEmpty\"; cachedValueLexeme?: string; formulaIdentityFingerprint?: string; formulaMetadataFingerprint?: string; cachedSemanticValueFingerprint?: string; ownerGeneration?: number; workbookGeneration?: number }".into(),
        ),
    );

    // ── Pivot crate types ──────────────────────────────────────────────────────
    // FieldId — transparent newtype around String, serializes as bare string
    map.insert("FieldId".to_string(), bridge_ts::types::TsType::String);
    // PlacementId / CalculatedFieldId / member keys — transparent string newtypes
    map.insert("PlacementId".to_string(), bridge_ts::types::TsType::String);
    map.insert(
        "CalculatedFieldId".to_string(),
        bridge_ts::types::TsType::String,
    );
    map.insert(
        "PivotMemberKey".to_string(),
        bridge_ts::types::TsType::String,
    );
    map.insert(
        "PivotTupleKey".to_string(),
        bridge_ts::types::TsType::String,
    );
    map.insert(
        "PivotValueSource".to_string(),
        bridge_ts::types::TsType::Named(
            "{ type: \"field\"; fieldId: string } | { type: \"calculatedField\"; calculatedFieldId: string }".into(),
        ),
    );
    // CellRange — type alias for cell_types::SheetRange in compute-pivot
    map.insert(
        "CellRange".to_string(),
        bridge_ts::types::TsType::Named("SheetRange".into()),
    );
    // PivotFieldPlacement remains an engine-only tagged enum. Public wire config
    // uses PivotFieldPlacementFlat from domain-types.
    // ShowValuesAsBaseItem — tagged enum (#[serde(tag = "type")]); inline the union
    map.insert(
        "ShowValuesAsBaseItem".to_string(),
        bridge_ts::types::TsType::Named(
            "{ type: \"relative\"; position: \"previous\" | \"next\" } | { type: \"specific\"; value: CellValue }".into(),
        ),
    );
    // PivotFilterCondition — tagged enum (#[serde(tag = "operator")]); inline flat form
    map.insert(
        "PivotFilterCondition".to_string(),
        bridge_ts::types::TsType::Named(
            "{ operator: FilterOperator; value?: CellValue; value2?: CellValue }".into(),
        ),
    );

    TypeGenConfig {
        external_type_map: map,
        default_rename_all: Some("camelCase".to_string()),
    }
}

fn read_snapshot_source(filename: &str) -> String {
    read_compute_types_source(&format!("snapshot-types/src/{filename}"))
}

fn read_compute_types_source(relative_path: &str) -> String {
    let path = format!(
        "{}/../../../compute/core/crates/types/{}",
        env!("CARGO_MANIFEST_DIR"),
        relative_path
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e))
}

fn read_compute_types_sources(relative_paths: &[&str]) -> String {
    relative_paths
        .iter()
        .map(|path| read_compute_types_source(path))
        .collect::<Vec<_>>()
        .join("\n")
}

fn mutation_source_files() -> &'static [&'static str] {
    &[
        "snapshot-types/src/mutation/primitives.rs",
        "snapshot-types/src/mutation/cell_grid.rs",
        "snapshot-types/src/mutation/features.rs",
        "snapshot-types/src/mutation/floating_objects.rs",
        "snapshot-types/src/mutation/policy_parse.rs",
        "snapshot-types/src/mutation/result.rs",
        "snapshot-types/src/mutation/sheet_workbook.rs",
    ]
}

fn position_source_files() -> &'static [&'static str] {
    &[
        "cell-types/src/position/point.rs",
        "cell-types/src/position/sheet_range.rs",
        "cell-types/src/position/range_pos.rs",
    ]
}

// ─── Settings types (camelCase) ─────────────────────────────────────────────

#[test]
fn settings_types_generate() {
    let source = read_snapshot_source("settings.rs");
    let ts = generate_types_from_source(&source, &compute_config()).unwrap();

    // WorkbookSettings has rename_all = "camelCase"
    assert!(
        ts.contains("export interface WorkbookSettings"),
        "WorkbookSettings interface"
    );

    // CalculationSettings has rename_all = "camelCase"
    assert!(
        ts.contains("export interface CalculationSettings"),
        "CalculationSettings interface"
    );

    // EnterKeyDirection should be a string union with PascalCase variants
    assert!(ts.contains("EnterKeyDirection"), "EnterKeyDirection type");
}

// ─── Mutation types (mixed naming) ──────────────────────────────────────────

#[test]
fn mutation_types_generate() {
    let source = read_compute_types_sources(mutation_source_files());
    let ts = generate_types_from_source(&source, &compute_config()).unwrap();

    // Axis enum with rename_all = "lowercase"
    assert!(ts.contains("\"row\""), "Axis should have lowercase 'row'");
    assert!(ts.contains("\"col\""), "Axis should have lowercase 'col'");
}

// ─── Recalc types (snake_case default) ──────────────────────────────────────

#[test]
fn recalc_types_generate() {
    let source = read_snapshot_source("recalc.rs");
    let ts = generate_types_from_source(&source, &compute_config()).unwrap();

    // CellEdit should be present
    assert!(ts.contains("CellEdit"), "CellEdit should be generated");

    // Auto-generated header
    assert!(
        ts.contains("Auto-generated by bridge-ts"),
        "should have auto-generated header"
    );
}

// ─── Viewport types ─────────────────────────────────────────────────────────

#[test]
fn viewport_types_generate() {
    let source = read_snapshot_source("viewport.rs");
    let ts = generate_types_from_source(&source, &compute_config()).unwrap();

    // ActiveCellData should be present (ViewportData was removed — JSON viewport path is gone)
    assert!(
        ts.contains("ActiveCellData"),
        "ActiveCellData should be generated"
    );
}

// ─── No parse errors ────────────────────────────────────────────────────────

#[test]
fn all_snapshot_files_parse_without_error() {
    let config = compute_config();
    for filename in &[
        "recalc.rs",
        "viewport.rs",
        "settings.rs",
        "init.rs",
        "object_ops.rs",
    ] {
        let source = read_snapshot_source(filename);
        let result = generate_types_from_source(&source, &config);
        assert!(
            result.is_ok(),
            "Failed to parse {}: {}",
            filename,
            result.unwrap_err()
        );
    }
    let mutation_source = read_compute_types_sources(mutation_source_files());
    let result = generate_types_from_source(&mutation_source, &config);
    assert!(
        result.is_ok(),
        "Failed to parse mutation source files: {}",
        result.unwrap_err()
    );

    // Domain types — all migrated to domain-types crate by domain-types migration refactors.
    // Parse tests for domain-types files are handled via the sub-crate paths below.

    // Sub-crate types
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let sub_crate_files = [
        // domain-types: SmartArt + WordArt modules
        format!("{manifest_dir}/../../../domain-types/src/domain/smartart.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/text_effects.rs"),
        // domain-types analytics (canonical, moved from compute-stats/src/types.rs)
        format!("{manifest_dir}/../../../domain-types/src/domain/analytics.rs"),
        format!(
            "{manifest_dir}/../../../compute/core/crates/compute-stats/src/regression_types.rs"
        ),
        format!("{manifest_dir}/../../../compute/core/crates/compute-charts/src/types.rs"),
        format!("{manifest_dir}/../../../compute/core/crates/compute-cf/src/types/mod.rs"),
        format!("{manifest_dir}/../../../compute/core/crates/compute-table/src/types.rs"),
        // domain-types custom_table_style (canonical, moved from compute-table/src/custom_styles.rs)
        format!("{manifest_dir}/../../../domain-types/src/domain/custom_table_style.rs"),
        format!("{manifest_dir}/../../../compute/core/crates/compute-formats/src/input.rs"),
        // pivot types (canonical, moved from pivot-types to domain-types/src/domain/pivot/)
        format!("{manifest_dir}/../../../domain-types/src/domain/pivot/field.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/pivot/show_values_as.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/pivot/placement_flat.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/pivot/filter.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/pivot/config.rs"),
        // item.rs and result.rs remain in pivot-types (not moved to domain-types)
        format!("{manifest_dir}/../../../compute/core/crates/types/pivot-types/src/result.rs"),
    ];
    for path in &sub_crate_files {
        let source = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));
        let result = generate_types_from_source(&source, &config);
        assert!(
            result.is_ok(),
            "Failed to parse {}: {}",
            path.rsplit('/').next().unwrap(),
            result.unwrap_err()
        );
    }
}

#[test]
fn pivot_config_generates_canonical_flat_placements() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let domain_base = format!("{manifest_dir}/../../../domain-types/src/domain/pivot");
    let source_files = [
        format!("{domain_base}/placement_flat.rs"),
        format!("{domain_base}/config.rs"),
    ];
    let config = compute_config();
    let mut all_defs = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    for path in source_files {
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));
        for def in bridge_ts::parse_types(&source, &config).unwrap() {
            if seen_names.insert(def.name().to_string()) {
                all_defs.push(def);
            }
        }
    }

    let ts = bridge_ts::emit_type_defs(&all_defs, None);
    let config_start = ts
        .find("export interface PivotTableConfig")
        .expect("PivotTableConfig should be generated");
    let config_body = &ts[config_start..];
    let config_end = config_body
        .find("\n}\n")
        .map(|offset| config_start + offset)
        .expect("PivotTableConfig interface should terminate");
    let config = &ts[config_start..config_end];

    assert!(
        config.contains("placements: PivotFieldPlacementFlat[];"),
        "PivotTableConfig must expose flat boundary placements:\n{config}"
    );
    assert!(
        !config.contains("placements: string"),
        "PivotTableConfig placements must not regress to custom-serde string fallback:\n{config}"
    );
    assert!(
        !config.contains("placements: unknown"),
        "PivotTableConfig placements must not become opaque:\n{config}"
    );
    assert!(
        !config.contains("placements: PivotFieldPlacement[]"),
        "PivotTableConfig must not expose the internal typed engine placement enum:\n{config}"
    );
}

// ─── Import configuration ───────────────────────────────────────────────────

/// Build the ImportConfig for compute-types.ts.
///
/// Maps external types referenced in snapshot-types to their source module.
/// `unknown` is a built-in TS type and is NOT included here.
fn build_import_config() -> ImportConfig {
    ImportConfig {
        groups: vec![
            // CellValue, CellFormat from contracts
            ImportGroup {
                from: "@mog-sdk/contracts/core".to_string(),
                types: vec![
                    TypeImport {
                        local_name: "CellValue".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "CellFormat".into(),
                        imported_name: None,
                    },
                ],
            },
            // Hand-written leaf wire types live in `./types`. Previously this
            // import group pointed at `./compute-bridge`, which created a
            // codegen cycle (compute-types.gen.ts -> compute-bridge.ts ->
            // compute-types.gen.ts via the re-export chain).
            ImportGroup {
                from: "./types".to_string(),
                types: vec![
                    TypeImport {
                        local_name: "IdentityFormula".into(),
                        imported_name: Some("IdentityFormulaWire".into()),
                    },
                    TypeImport {
                        local_name: "NamedRangeDef".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "TableDef".into(),
                        imported_name: None,
                    },
                    // CFCellRange — type alias for SheetRange (position-based range)
                    TypeImport {
                        local_name: "CFCellRange".into(),
                        imported_name: None,
                    },
                    // CellIdRange — identity-based cell range
                    TypeImport {
                        local_name: "CellIdRange".into(),
                        imported_name: None,
                    },
                    // Rust `CfRenderStyle` (compute-cf::types::rule) is exported from
                    // compute-bridge.ts as `CFStyle` (the persistence/wire name). See
                    // compute-wire-types.ts: CFStyle was renamed from the Rust-side
                    // CfRenderStyle to avoid codegen collision with domain-types' own CFStyle.
                    TypeImport {
                        local_name: "CfRenderStyle".into(),
                        imported_name: Some("CFStyle".into()),
                    },
                    TypeImport {
                        local_name: "NonNullPatch".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "NullablePatch".into(),
                        imported_name: None,
                    },
                    // `Scope` (formula_types::Scope) is referenced by DefinedNameWire.
                    // Hand-written in compute-wire-types.ts because its custom Serialize
                    // produces `"Workbook"` | `{ Sheet: string }` (externally tagged enum).
                    TypeImport {
                        local_name: "Scope".into(),
                        imported_name: None,
                    },
                ],
            },
            ImportGroup {
                from: "../../../../infra/rust-bridge/bridge-ts/generated/ooxml-types".to_string(),
                types: vec![
                    TypeImport {
                        local_name: "ColorScheme".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "FontScheme".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "FormatScheme".into(),
                        imported_name: None,
                    },
                    TypeImport {
                        local_name: "SpreadsheetGraphicFrame".into(),
                        imported_name: None,
                    },
                ],
            },
        ],
    }
}

// ─── Combined output generation ─────────────────────────────────────────────

/// Reads all snapshot-types source files and writes a combined compute-types.ts
/// to the generated/ directory.
///
/// Run: cargo test -p bridge-ts --test generate_compute_types -- generate_combined --nocapture
#[test]
fn generate_combined() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let base = format!("{manifest_dir}/../../../compute/core/crates/types");
    let stats_base = format!("{manifest_dir}/../../../compute/core/crates/compute-stats/src");
    let charts_base = format!("{manifest_dir}/../../../compute/core/crates/compute-charts/src");
    let cf_base = format!("{manifest_dir}/../../../compute/core/crates/compute-cf/src");
    let table_base = format!("{manifest_dir}/../../../compute/core/crates/compute-table/src");
    let formats_base = format!("{manifest_dir}/../../../compute/core/crates/compute-formats/src");
    let pivot_base = format!("{manifest_dir}/../../../compute/core/crates/types/pivot-types/src");
    let domain_base = format!("{manifest_dir}/../../../domain-types/src/domain");
    let config = compute_config();

    let source_files = [
        // cell-types (canonical SheetPos, SheetRange, etc.)
        format!("{}/{}", base, position_source_files()[0]),
        format!("{}/{}", base, position_source_files()[1]),
        format!("{}/{}", base, position_source_files()[2]),
        // cell-types range enums (RangeKind, RangeAnchor, PayloadEncoding)
        format!("{}/cell-types/src/range_id.rs", base),
        // snapshot-types
        format!("{}/snapshot-types/src/init.rs", base),
        format!("{}/snapshot-types/src/recalc.rs", base),
        format!("{}/{}", base, mutation_source_files()[0]),
        format!("{}/{}", base, mutation_source_files()[1]),
        format!("{}/{}", base, mutation_source_files()[2]),
        format!("{}/{}", base, mutation_source_files()[3]),
        format!("{}/{}", base, mutation_source_files()[4]),
        format!("{}/{}", base, mutation_source_files()[5]),
        format!("{}/{}", base, mutation_source_files()[6]),
        format!("{}/snapshot-types/src/viewport.rs", base),
        format!("{}/snapshot-types/src/settings.rs", base),
        format!("{}/snapshot-types/src/scenario.rs", base),
        format!("{}/snapshot-types/src/floating_objects.rs", base),
        format!("{}/snapshot-types/src/queries.rs", base),
        format!("{}/snapshot-types/src/object_ops.rs", base),
        format!("{}/snapshot-types/src/grouping.rs", base),
        format!("{}/snapshot-types/src/bindings.rs", base),
        format!("{}/snapshot-types/src/cell_ops.rs", base),
        // domain-types crate — all types migrated from compute/core/domain_types by domain-types migration
        format!("{manifest_dir}/../../../domain-types/src/domain/merge.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/sparkline.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/formatting.rs"),
        // other compute-core source files
        format!("{manifest_dir}/../../../compute/core/src/range_manager.rs"),
        // engine files (for TableHitRegion, AutoExpansionResult, MergeRangeRef)
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/mod.rs"),
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/tables.rs"),
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/queries.rs"),
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/cell_semantics.rs"),
        format!("{manifest_dir}/../../../compute/core/src/diagnostics/formula_references/types.rs"),
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/search.rs"),
        format!("{manifest_dir}/../../../compute/core/src/storage/engine/mutation.rs"),
        format!("{manifest_dir}/../../../compute/core/src/engine_types/ranges.rs"),
        format!("{manifest_dir}/../../../compute/core/src/engine_types/fill.rs"),
        format!("{manifest_dir}/../../../compute/core/src/engine_types/cf.rs"),
        // engine_types/queries.rs — DefinedNameWire (bridge wire type separate from domain DefinedName)
        format!("{manifest_dir}/../../../compute/core/src/engine_types/queries.rs"),
        // bridge_pure.rs — TableNameValidationResult (wire struct defined alongside its pure bridge impl)
        format!("{manifest_dir}/../../../compute/core/src/bridge_pure.rs"),
        // sub-crate types
        // domain-types analytics (AggregateFunction, SortDirection, DateGrouping, etc.)
        // MUST come before compute-table/types.rs: both define SortDirection with different
        // serialization; analytics' ("asc"/"desc") is the canonical pivot-engine format.
        // De-duplication keeps the first definition (analytics) and skips compute-table's.
        format!("{domain_base}/analytics.rs"),
        format!("{stats_base}/regression_types.rs"),
        format!("{charts_base}/types.rs"),
        // compute-cf output types (CellCFResult, DataBarResult, ColorScaleResult, IconResult,
        // CFDataBarDirection, CfIconSetName). Input types that overlap with domain_types/cf.rs
        // (CFStyle, CFRule, etc.) are de-duped by the seen_names set above.
        //
        // `types/mod.rs` is a barrel of `mod` + `pub use`; the generator reads source text
        // so we must list each submodule that defines types we need. `enums.rs` provides
        // CfIconSetName/CFValueType/etc.; `result.rs` provides CellCFResult/DataBarResult/
        // ColorScaleResult/IconResult.
        format!("{cf_base}/types/mod.rs"),
        format!("{cf_base}/types/enums.rs"),
        format!("{cf_base}/types/result.rs"),
        format!("{table_base}/types.rs"),
        format!("{domain_base}/custom_table_style.rs"),
        format!("{formats_base}/input.rs"),
        // domain-types crate (external — canonical types moved from compute-core domain_types)
        format!("{manifest_dir}/../../../domain-types/src/domain/comment.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/sheet.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/connections.rs"),
        format!(
            "{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/classification.rs"
        ),
        format!(
            "{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/value_ref.rs"
        ),
        format!(
            "{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/style.rs"
        ),
        format!(
            "{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/visual.rs"
        ),
        format!("{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/rule.rs"),
        format!(
            "{manifest_dir}/../../../domain-types/src/domain/conditional_format/types/format.rs"
        ),
        format!("{manifest_dir}/../../../domain-types/src/domain/table.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/validation/spec.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/validation/schema_types.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/validation/result.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/grouping.rs"),
        // chart module — split from chart.rs into chart/ directory (pass 1 refactor)
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/mod.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/axis.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/data_table.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/formatting.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/labels.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/legend.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/position.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/series.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/spec.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/chart/view_3d.rs"),
        format!("{manifest_dir}/../../../domain-types/src/diagnostics.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/filter/ooxml_sort.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/filter/ooxml.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/filter/advanced.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/filter/runtime.rs"),
        // SmartArt types — must come BEFORE floating object types because SmartArtData
        // references SmartArtDefinition and SmartArtCategory.
        format!("{manifest_dir}/../../../domain-types/src/domain/smartart.rs"),
        // Floating object module — split from floating_object.rs into floating_object/.
        // Keep style.rs before text_effects.rs because both define
        // GradientType/GradientStop/ShadowAlignment/OuterShadowEffect; floating_object/style.rs
        // has the canonical versions and text_effects.rs adds extras (e.g. GradientType::Path).
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/anchor.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/chart.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/common.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/drawing.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/objects.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/ooxml.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/shape_type.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/style.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/floating_object/mod.rs"),
        // WordArt types — must come AFTER floating object style types because both define
        // GradientType/GradientStop/ShadowAlignment/OuterShadowEffect; floating object style
        // has the canonical versions and text_effects.rs adds extras (e.g. GradientType::Path).
        // De-duplication keeps the first (floating_object) definition.
        format!("{manifest_dir}/../../../domain-types/src/domain/text_effects.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/copy.rs"),
        format!("{manifest_dir}/../../../domain-types/src/properties.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/named_range.rs"),
        // theme.rs — ThemeData wire format for getWorkbookTheme/setWorkbookTheme bridges.
        format!("{manifest_dir}/../../../domain-types/src/domain/theme.rs"),
        // pivot types — MUST come before slicer.rs because both define PivotFieldArea;
        // the pivot version has all 4 variants (row/column/value/filter) while slicer's has only 3.
        // Canonical definitions now live in domain-types/src/domain/pivot/.
        format!("{domain_base}/pivot/field.rs"),
        format!("{domain_base}/pivot/show_values_as.rs"),
        // placement.rs skipped — tagged enum with #[serde(flatten)] inner structs;
        // public wire config uses the flat boundary DTO instead.
        format!("{domain_base}/pivot/placement_flat.rs"),
        format!("{domain_base}/pivot/filter.rs"),
        format!("{domain_base}/pivot/config.rs"),
        // item.rs and result.rs remain in pivot-types (not moved to domain-types)
        format!("{pivot_base}/item.rs"),
        format!("{pivot_base}/result.rs"),
        // NOTE: expansion.rs skipped — PivotExpansionState has custom serde (HashSet as array)
        // that the parser can't handle. Kept in @mog-sdk/contracts/pivot for now.
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/source.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/style.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/items.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/stored.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/events.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/slicer/timeline.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/print.rs"),
        format!("{manifest_dir}/../../../domain-types/src/domain/cell_style.rs"),
        // CSV parser options module. Lives in its
        // own file so the bridge codegen can pull it without dragging in the
        // wider parser type graph (cf. comment at file head). Wiring it in
        // here completes the auto-regen path; the previous hand-added stub
        // in compute-types.gen.ts had `?:` optional markers from manual edits
        // that the auto-gen does not emit (Option<T> field with #[serde(default)]
        // produces `: T | null` required-but-nullable). The TS call sites have
        // pre-existing pass-undefined patterns that don't match the auto-gen
        // shape — that's a separate cleanup, not in scope for kernel-state-mirror
        // pass 2 step 1. Path is included so the codegen is whole; the TS
        // call sites continue to work because `undefined` and `null` both
        // serialize identically when consumed by the JSON wire bridge.
        format!("{manifest_dir}/../../../file-io/csv-parser/src/options.rs"),
        // NOTE: grouping_render.rs was in compute/core/domain_types, now deleted by domain-types migration
    ];

    let mut all_defs = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    for path in &source_files {
        let source = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));
        // BridgeSortMode (compute/core/src/storage/engine/mutation.rs) uses
        // `#[serde(tag = "kind", rename_all_fields = "camelCase")]`. The
        // bridge-ts parser handles `tag` and `rename_all` but not
        // `rename_all_fields` (the latter renames inner-variant fields, e.g.
        // `custom_list` -> `customList`). Rust JSON wire emits `customList`;
        // pre-rewrite the field name in the source so the generator produces
        // the correct TS surface. Until bridge-ts gains first-class support,
        // this keeps `BridgeSortMode_value.customList` matching the wire.
        let source = if path.ends_with("mutation.rs") && source.contains("rename_all_fields") {
            source.replace("custom_list:", "customList:")
        } else {
            source
        };
        let defs = bridge_ts::parse_types(&source, &config).unwrap();
        let count_before = all_defs.len();
        for def in defs {
            if seen_names.insert(def.name().to_string()) {
                all_defs.push(def);
            } else {
                eprintln!("  skipping duplicate: {}", def.name());
            }
        }
        eprintln!(
            "{}: {} types",
            path.rsplit('/').next().unwrap(),
            all_defs.len() - count_before
        );
    }

    let imports = build_import_config();
    let mut ts = bridge_ts::emit_type_defs(&all_defs, Some(&imports));

    // Manual type aliases for types with custom Serialize impls that the parser
    // cannot derive automatically.
    ts.push_str("\n\n// Manual type aliases for types with custom Serialize impls\n\n");
    ts.push_str("/**\n");
    ts.push_str(" * A floating object: common metadata + type-specific data.\n");
    ts.push_str(" * Rust `FloatingObject` uses a custom Serialize impl that merges\n");
    ts.push_str(
        " * `FloatingObjectCommon` and `FloatingObjectData` into a single flat JSON object.\n",
    );
    ts.push_str(" */\n");
    ts.push_str("export type FloatingObject = FloatingObjectCommon & FloatingObjectData;\n");

    eprintln!(
        "\nGenerated compute-types.ts: {} bytes, {} types",
        ts.len(),
        all_defs.len()
    );

    let output_path = format!(
        "{}/../../../kernel/src/bridges/compute/compute-types.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::write(&output_path, &ts).unwrap();
    eprintln!("Written to: {}", output_path);
}
