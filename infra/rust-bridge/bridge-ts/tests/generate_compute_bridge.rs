//! One-shot integration test to generate the compute-core TS bridge.
//!
//! Run: cargo test -p bridge-ts --test generate_compute_bridge -- --nocapture
//! Output: kernel/src/bridges/compute/compute-bridge.gen.ts

use bridge_ts::{
    BridgeConfig, collect_named_from_api, emit_bridge, emit_kind_manifest, merge_blocks,
    parse_source,
};
use bridge_ts::{ImportConfig, ImportGroup, TypeImport};

#[test]
fn generate_compute_bridge() {
    let base = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");

    let source_files = vec![
        format!("{}/compute/core/src/storage/engine/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/bridge_imports.rs", base),
        format!("{}/compute/core/src/storage/engine/workbook_theme.rs", base),
        format!("{}/compute/core/src/storage/engine/cell_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/undo_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/sync_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/screenshot.rs", base),
        format!("{}/compute/core/src/bridge_pure.rs", base),
        format!("{}/compute/core/src/storage/engine/delegations.rs", base),
        format!("{}/compute/core/src/storage/engine/viewport/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/queries.rs", base),
        format!("{}/compute/core/src/storage/engine/structural/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/formatting/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/tables.rs", base),
        format!("{}/compute/core/src/storage/engine/features/mod.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/comments.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/charts.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/floating.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/groups.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/z_order.rs",
            base
        ),
        format!(
            "{}/compute/core/src/storage/engine/objects/hyperlinks.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/pivots.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/viewport/registry.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/layout.rs", base),
        format!("{}/compute/core/src/storage/engine/cell_semantics.rs", base),
        format!("{}/compute/core/src/storage/engine/search.rs", base),
        format!("{}/compute/core/src/storage/engine/atomics.rs", base),
        format!("{}/compute/core/src/storage/engine/styles.rs", base),
    ];

    let mut all_blocks = Vec::new();
    for path in &source_files {
        let source = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));
        let blocks = parse_source(&source).unwrap();
        eprintln!(
            "{}: {} blocks, {} methods",
            path.rsplit('/').next().unwrap(),
            blocks.len(),
            blocks.iter().map(|b| b.methods.len()).sum::<usize>()
        );
        all_blocks.extend(blocks);
    }

    let api = merge_blocks(all_blocks);

    eprintln!("\nMerged services:");
    for svc in &api.services {
        eprintln!("  {} ({} methods)", svc.rust_name, svc.methods.len());
    }

    // Print all referenced Named types for debugging
    let named = collect_named_from_api(&api);
    eprintln!("\nReferenced Named types ({}):", named.len());
    for name in &named {
        eprintln!("  {}", name);
    }

    let imports = build_import_config();
    let bridge_config = BridgeConfig {
        core_type_name: "ComputeCore".into(),
        core_import_path: "./compute-core".into(),
        interface_name: "GeneratedBridgeMethods".into(),
        class_name: "GeneratedBridgeBase".into(),
    };

    let ts = emit_bridge(&api, Some(&imports), Some(&bridge_config));

    eprintln!(
        "\nGenerated TS: {} bytes, {} lines",
        ts.len(),
        ts.lines().count()
    );

    let output_path = format!(
        "{}/../../../kernel/src/bridges/compute/compute-bridge.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::write(&output_path, &ts).unwrap();
    eprintln!("Written to: {}", output_path);

    // ── Method-kind manifest ──
    // Emitted alongside the bridge so the two files stay in lockstep: every
    // method on `GeneratedBridgeMethods` has exactly one entry in
    // `BRIDGE_METHOD_KIND`, and the order matches.
    let manifest_ts = emit_kind_manifest(&api);
    let manifest_path = format!(
        "{}/../../../kernel/src/bridges/compute/manifest.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::write(&manifest_path, &manifest_ts).unwrap();

    let entry_count = manifest_ts.lines().filter(|l| l.contains(": '")).count();
    eprintln!(
        "Manifest: {} bytes, {} entries — written to: {}",
        manifest_ts.len(),
        entry_count,
        manifest_path
    );
}

fn build_import_config() -> ImportConfig {
    ImportConfig {
        groups: vec![
            // Group 1: Generated snapshot types (from compute-types.gen.ts)
            ImportGroup {
                from: "./compute-types.gen".into(),
                types: vec![
                    ti("A1CellRef"),
                    ti("A1RangeRef"),
                    ti("ActiveCellData"),
                    ti("AutoExpansionResult"),
                    ti("BatchCellInput"),
                    ti("BatchRangeRequest"),
                    ti("BatchRangeResponse"),
                    ti("BridgeAdjustedRef"),
                    ti("BridgeAutoFillChange"),
                    ti("BridgeAutoFillFormulaPreview"),
                    ti("BridgeAutoFillPreviewResult"),
                    ti("BridgeAutoFillRequest"),
                    ti("BridgeAutoFillReferenceDiagnostic"),
                    ti("BridgeAutoFillWarning"),
                    ti("BridgeAutoFillWarningKind"),
                    ti("BridgeFlashFillRequest"),
                    ti("BridgeSortCriterion"),
                    ti("BridgeSortOptions"),
                    ti("CFColorScale"),
                    ti("CFDataBar"),
                    ti("CFIconSetName"),
                    ti("CFIconSetPreset"),
                    ti("CFPresetCategory"),
                    ti("CFRule"),
                    ti("CacheInvalidationEventReason"),
                    alias("CanonicalTable", "Table"),
                    ti("CellCFResult"),
                    ti("CalculationSettings"),
                    // ChartStatistics relocated from bridge_pure.rs to
                    // snapshot-types/queries.rs in nullable-boundary — now generated.
                    ti("ChartStatistics"),
                    ti("Comment"),
                    ti("CommentMention"),
                    ti("CommentType"),
                    ti("CellEdit"),
                    ti("CellInput"),
                    ti("CellPosition"),
                    ti("CellPositionResult"),
                    ti("CellInfo"),
                    ti("CellStyleDef"),
                    ti("CellMergeInfo"),
                    ti("SheetPos"),
                    ti("CellValidationResult"),
                    ti("ColumnEdge"),
                    ti("ColumnFilter"),
                    ti("AdvancedFilterRequest"),
                    ti("DynamicFilterRule"),
                    ti("ConditionalFormat"),
                    ti("CopyType"),
                    ti("CreateBindingInput"),
                    ti("CreateShapeConfig"),
                    ti("DataBounds"),
                    ti("DefaultFont"),
                    ti("DefinedName"),
                    ti("DefinedNameInput"),
                    ti("DefinedNameWire"),
                    ti("DisconnectionEventReason"),
                    ti("DocumentProperties"),
                    ti("FillConfig"),
                    ti("FillType"),
                    ti("FilterHeaderInfo"),
                    ti("FilterRecordCount"),
                    ti("FilterSortState"),
                    ti("FilterState"),
                    ti("FormulaReferenceDiagnosticsOptions"),
                    ti("FormulaReferenceDiagnosticsPage"),
                    ti("RuntimeDiagnosticsOptions"),
                    ti("RuntimeDiagnosticsPage"),
                    ti("FloatingObjectBounds"),
                    ti("FlipAxis"),
                    ti("FrozenPanes"),
                    ti("GradientConfig"),
                    ti("GradientStop"),
                    ti("GradientType"),
                    ti("GroupDefinition"),
                    ti("HorizontalAlign"),
                    ti("Hyperlink"),
                    ti("IdentityCell"),
                    ti("IdentityMergedRegion"),
                    ti("ImportDiagnostic"),
                    ti("LineEnd"),
                    ti("LineEndSize"),
                    ti("LineEndType"),
                    ti("MergeRegion"),
                    ti("MoveTarget"),
                    ti("MutationResult"),
                    ti("SyncApplyMutationMetadataWire"),
                    ti("SyncApplyOperationContextWire"),
                    ti("NameValidationResult"),
                    ti("NamedRangeUpdate"),
                    ti("OutlineConfig"),
                    ti("OutlineLevel"),
                    ti("OutlineLevelButton"),
                    ti("OutlineRenderData"),
                    ti("OutlineSettingsUpdate"),
                    ti("OutlineStyle"),
                    ti("OutlineSymbol"),
                    ti("ProjectionData"),
                    ti("ProtectedWorkbookOperation"),
                    ti("RawCellData"),
                    ti("RangeCellData"),
                    ti("RangeQueryResult"),
                    ti("RangeSchema"),
                    ti("RecalcResult"),
                    ti("RectBounds"),
                    ti("RowEdge"),
                    ti("RegexSearchMatch"),
                    ti("RegexSearchOptions"),
                    ti("RegexSearchResult"),
                    ti("RelocateResult"),
                    ti("ResolvedMergedRegion"),
                    ti("ResizeAnchor"),
                    ti("ResizeConfig"),
                    ti("Scenario"),
                    ti("ScenarioActiveState"),
                    ti("ScenarioApplyResult"),
                    ti("ScenarioCreateInput"),
                    ti("ScenarioCreateResult"),
                    ti("ScenarioOriginalCellValue"),
                    ti("ScenarioRestoreResult"),
                    ti("ScenarioUpdateInput"),
                    ti("ScenarioUpdateResult"),
                    ti("SelectionAggregates"),
                    ti("SetCellsBatchResult"),
                    ti("FloatingObject"),
                    ti("SerializedFloatingObjectGroup"),
                    ti("ShadowAlignment"),
                    ti("ShadowConfig"),
                    ti("ShapeStyleUpdate"),
                    ti("ShapeTextConfig"),
                    ti("ShapeType"),
                    ti("SheetDataBinding"),
                    ti("FindInRangeOptions"),
                    ti("FindInRangeResult"),
                    ti("WorkbookSearchMatch"),
                    ti("WorkbookSearchResult"),
                    ti("SignAnomaly"),
                    ti("SignCheckOptions"),
                    ti("SignCheckResult"),
                    ti("SignNeighbor"),
                    ti("SheetGroupingConfig"),
                    ti("SheetMeta"),
                    ti("SheetPrintSettings"),
                    ti("SheetProtectionConfig"),
                    ti("SheetProtectionOptions"),
                    ti("SheetScrollPosition"),
                    ti("SheetSettings"),
                    ti("SheetSnapshot"),
                    ti("SheetViewOptions"),
                    ti("SplitViewConfig"),
                    ti("SlicerItem"),
                    ti("StoredSlicer"),
                    ti("StoredSlicerUpdate"),
                    ti("SlicerSource"),
                    ti("SlicerStyle"),
                    ti("SlicerStylePreset"),
                    ti("SlicerCustomStyle"),
                    ti("NamedSlicerStyle"),
                    ti("CrossFilterMode"),
                    ti("CsvImportOptions"),
                    ti("SlicerStyleSortOrder"),
                    ti("PivotFieldArea"),
                    ti("PivotFieldItems"),
                    ti("ImportedPivotViewRecord"),
                    ti("PivotTableConfig"),
                    ti("PivotTableResult"),
                    ti("PivotField"),
                    ti("PivotFieldPlacementFlat"),
                    ti("PivotFilter"),
                    ti("PivotTopBottomFilter"),
                    ti("PivotTableLayout"),
                    ti("PivotTableStyle"),
                    ti("PivotTableDataOptions"),
                    ti("PivotHeader"),
                    ti("PivotRow"),
                    ti("PivotColumnHeader"),
                    ti("PivotGrandTotals"),
                    ti("AggregateFunction"),
                    ti("DetectedDataType"),
                    ti("DateGrouping"),
                    ti("ShowValuesAs"),
                    ti("ShowValuesAsConfig"),
                    ti("SortByValueConfig"),
                    ti("TopBottomType"),
                    ti("TopBottomBy"),
                    ti("OutputLocation"),
                    ti("CalculatedField"),
                    ti("LayoutForm"),
                    ti("SubtotalLocation"),
                    ti("HeaderFooterImageInfo"),
                    ti("HfImagePosition"),
                    ti("PrintRange"),
                    ti("PrintSettings"),
                    ti("PrintTitles"),
                    ti("Sparkline"),
                    ti("SparklineGroup"),
                    ti("SparklineUpdate"),
                    ti("SubtotalOptions"),
                    ti("SubtotalResult"),
                    ti("CustomTableStyleConfig"),
                    ti("TableElementStyle"),
                    ti("StripePattern"),
                    ti("TableBoolOption"),
                    ti("TableColumn"),
                    ti("TableHitRegion"),
                    ti("TableNameValidationResult"),
                    ti("TableTopBottomFilter"),
                    ti("TextToColumnsOptions"),
                    ti("ThemeColor"),
                    ti("ThemeColorSource"),
                    ti("ThemeData"),
                    ti("Transform"),
                    ti("TotalsFunction"),
                    ti("UndoState"),
                    ti("UpdateBindingFields"),
                    ti("RustWorkbookSettingsPatch"),
                    ti("SemanticWorkbookDiff"),
                    ti("SemanticWorkbookState"),
                    ti("SemanticWorkbookStateEnvelope"),
                    ti("Viewport"),
                    ti("VerticalAlign"),
                    ti("WorkbookProtectionOptions"),
                    ti("WorkbookComment"),
                    ti("WorkbookPivotTable"),
                    ti("WorkbookSettings"),
                    ti("WorkbookSnapshot"),
                    ti("WorkbookTable"),
                    ti("ZOrderEntry"),
                ],
            },
            // Group 2: Hand-written leaf wire types (with aliases) + stub types.
            // Imported from `./types` — a pure leaf file with no imports back
            // into the hand-written composition root. Previously this group
            // pointed at `./compute-bridge`, which created a codegen cycle
            // (compute-bridge.gen.ts -> compute-bridge.ts -> compute-bridge.gen.ts).
            ImportGroup {
                from: "./types".into(),
                types: vec![
                    // Aliased wire types
                    alias("IdentityFormula", "IdentityFormulaWire"),
                    alias("ColumnSchema", "ColumnSchemaWire"),
                    alias("SchemaType", "SchemaTypeWire"),
                    alias("ValidationResult", "ValidationResultWire"),
                    alias("EditorTypeResolutionInput", "EditorTypeResolutionInputWire"),
                    alias(
                        "EditorTypeResolutionResult",
                        "EditorTypeResolutionResultWire",
                    ),
                    alias("InferredSchema", "InferredSchemaWire"),
                    // Direct exports
                    ti("NamedRangeDef"),
                    ti("TableDef"),
                    ti("StructureChange"),
                    // Chart bridge stubs
                    ti("DataRow"),
                    ti("Point"),
                    ti("RegressionMethod"),
                    ti("RegressionOptions"),
                    ti("RegressionOutput"),
                    ti("DensityResult"),
                    ti("HistogramBin"),
                    ti("StackInput"),
                    ti("StackMode"),
                    ti("StackOutput"),
                    // Format bridge stubs
                    ti("FormatEntry"),
                    ti("DateValueResult"),
                    ti("ParsedDateInput"),
                    ti("FormulaCircularReferenceValidation"),
                    ti("Locale"),
                    // CF bridge stubs
                    ti("CFRuleWire"),
                    // CFIconSetName is now emitted into compute-types.gen.ts (from compute-cf
                    // types/enums.rs), so it belongs in Group 1 — moved below.
                    ti("CfPresets"),
                    // Solver / data-table stubs
                    ti("GoalSeekParams"),
                    ti("GoalSeekResult"),
                    ti("CreateDataTableInput"),
                    ti("DataTableParams"),
                    ti("DataTableResult"),
                    ti("SolverParams"),
                    ti("SolverResult"),
                    // TableNameValidationResult now emitted into compute-types.gen.ts
                    // (from compute/core/src/bridge_pure.rs); moved to Group 1 below.
                    // Schema wire types
                    ti("SchemaMapEntryWire"),
                    // Engine stubs
                    ti("PageBreaks"),
                    // PrintRange / PrintTitles / SplitViewConfig / SheetSettings
                    // moved to Group 1 (compute-types.gen) — they are emitted
                    // there by `generate_combined()`. Listing them here would
                    // produce a `import ... from "./types"` line that fails to
                    // resolve at the leaf module.
                    // Table stubs (not in @mog/table-engine)
                    ti("TableRange"),
                    ti("SheetRange"),
                    ti("SlicerSortOrder"),
                    // Step 4: CF cell range (alias for SheetRange)
                    ti("CFCellRange"),
                ],
            },
            // Group 3: Table engine types
            ImportGroup {
                from: "@mog/table-engine".into(),
                types: vec![
                    ti("Table"),
                    ti("FilterCriteria"),
                    ti("Slicer"),
                    ti("SlicerCache"),
                    ti("SortSpec"),
                    ti("RowVisibility"),
                    ti("TableCellFormat"),
                    ti("TableStyleDef"),
                    ti("StructuredRef"),
                    ti("DynamicFilter"),
                    ti("TopBottomFilter"),
                    ti("FilterDropdownData"),
                    ti("TableStructureChange"),
                ],
            },
            // Group 4: Contracts core types
            ImportGroup {
                from: "@mog-sdk/contracts/core".into(),
                types: vec![ti("CellFormat"), ti("CellValue"), ti("SheetId")],
            },
            // Group 7: ResolvedCellFormat → CellFormat (same TS shape, dense serialization in Rust)
            ImportGroup {
                from: "@mog-sdk/contracts/core".into(),
                types: vec![alias("ResolvedCellFormat", "CellFormat")],
            },
            // Group 5: Contracts cell-identity types
            ImportGroup {
                from: "@mog-sdk/contracts/cell-identity".into(),
                types: vec![ti("CellId")],
            },
            // Group 6: PivotExpansionState kept in contracts (custom serde prevents codegen parsing)
            ImportGroup {
                from: "@mog-sdk/contracts/pivot".into(),
                types: vec![ti("PivotExpansionState")],
            },
        ],
    }
}

fn ti(name: &str) -> TypeImport {
    TypeImport {
        local_name: name.into(),
        imported_name: None,
    }
}

fn alias(local: &str, imported: &str) -> TypeImport {
    TypeImport {
        local_name: local.into(),
        imported_name: Some(imported.into()),
    }
}
