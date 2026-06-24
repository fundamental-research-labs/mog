use compute_document::schema::*;

use super::{
    SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION, SemanticCoverageClassification,
    SemanticCoverageDigestPart, SemanticCoverageRecord, SemanticCoverageScope,
    SemanticCoverageStatusEffect,
};

type CoverageShape = (
    SemanticCoverageClassification,
    SemanticCoverageDigestPart,
    SemanticCoverageStatusEffect,
    Option<&'static str>,
);

const INCLUDED: CoverageShape = (
    SemanticCoverageClassification::IncludedAuthored,
    SemanticCoverageDigestPart::Authored,
    SemanticCoverageStatusEffect::Clean,
    None,
);
const INCLUDED_COVERAGE_ONLY: CoverageShape = (
    SemanticCoverageClassification::IncludedAuthored,
    SemanticCoverageDigestPart::CoverageOnly,
    SemanticCoverageStatusEffect::Clean,
    None,
);
const DERIVED: CoverageShape = (
    SemanticCoverageClassification::DerivedExcluded,
    SemanticCoverageDigestPart::None,
    SemanticCoverageStatusEffect::Clean,
    Some("VERSIONING_DERIVED_SCHEMA_KEY"),
);

pub(super) fn semantic_coverage_records() -> Vec<SemanticCoverageRecord> {
    let mut records = Vec::new();

    push_paths(
        &mut records,
        SemanticCoverageScope::TopLevel,
        &["/workbook", "/sheets"],
        "workbook",
        INCLUDED_COVERAGE_ONLY,
        "vc03-schema-top-level",
    );
    push_paths(
        &mut records,
        SemanticCoverageScope::TopLevel,
        &["/security"],
        "security",
        unsupported("VERSIONING_UNSUPPORTED_SECURITY_SCHEMA"),
        "vc03-schema-top-level",
    );

    push_workbook_records(&mut records);
    push_sheet_records(&mut records);
    push_cell_records(&mut records);
    push_cell_property_records(&mut records);
    push_sheet_metadata_records(&mut records);
    push_security_records(&mut records);

    records.sort_by(|left, right| {
        (left.scope, left.source_path.as_str(), left.domain_owner).cmp(&(
            right.scope,
            right.source_path.as_str(),
            right.domain_owner,
        ))
    });
    records
}

fn push_workbook_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_workbook_keys(
        records,
        &[KEY_SHEET_ORDER, KEY_NAMED_RANGES],
        "workbook-authored",
        INCLUDED,
    );
    push_workbook_keys(
        records,
        &[KEY_SCHEMA_VERSION],
        "schema-compatibility",
        INCLUDED_COVERAGE_ONLY,
    );
    push_workbook_keys(
        records,
        &[
            KEY_STYLE_PALETTE,
            KEY_WORKBOOK_STYLESHEET,
            KEY_DXF_REGISTRY,
            KEY_CUSTOM_CELL_STYLES,
        ],
        "styles",
        unsupported("VERSIONING_UNSUPPORTED_STYLE_SCHEMA"),
    );
    push_workbook_keys(
        records,
        &[
            KEY_PACKAGE_FIDELITY_METADATA,
            KEY_XLSX_METADATA,
            KEY_FILE_VERSION,
        ],
        "package-fidelity",
        opaque("VERSIONING_OPAQUE_PACKAGE_FIDELITY_SCHEMA"),
    );
    push_workbook_keys(
        records,
        &[
            KEY_WORKBOOK_LINKS,
            KEY_WORKBOOK_CONNECTIONS,
            KEY_IMPORTED_EXTERNAL_CACHE,
            KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE,
            KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS,
            "volatileDependencyPackagePart",
        ],
        "external-data",
        opaque("VERSIONING_OPAQUE_EXTERNAL_DATA_SCHEMA"),
    );
    push_workbook_keys(
        records,
        &[
            KEY_WORKBOOK_SETTINGS,
            KEY_WORKBOOK_IDENTITY,
            KEY_TABLES,
            KEY_CUSTOM_TABLE_STYLES,
            KEY_DATA_TABLE_REGIONS,
            KEY_SLICERS,
            KEY_TIMELINES,
            KEY_PIVOT_SPECS,
            KEY_POWER_QUERY,
            KEY_SCENARIOS,
            KEY_THEME,
            KEY_DOCUMENT_PROPERTIES,
            KEY_EXTENDED_DOCUMENT_PROPERTIES,
            KEY_FILE_SHARING,
            KEY_WEB_PUBLISHING,
            KEY_THREADED_COMMENT_PERSONS,
            KEY_THREADED_COMMENT_PERSONS_PART_PRESENT,
            KEY_THREADED_COMMENT_PERSON_ORDER,
            "customWorkbookViewsXml",
        ],
        "workbook-unsupported",
        unsupported("VERSIONING_UNSUPPORTED_WORKBOOK_SCHEMA"),
    );
    push_workbook_keys(
        records,
        &[
            KEY_XLSX_TABLE_STYLES,
            KEY_IMPORTED_PIVOT_ASSOCIATIONS,
            KEY_PIVOT_CACHE_SOURCES,
            KEY_PIVOT_CACHE_RECORDS,
        ],
        "workbook-opaque",
        opaque("VERSIONING_OPAQUE_WORKBOOK_SCHEMA"),
    );
    push_workbook_keys(
        records,
        &[KEY_SHARED_STRING_HINTS],
        "shared-strings",
        DERIVED,
    );
}

fn push_sheet_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_sheet_keys(
        records,
        SemanticCoverageScope::Sheet,
        &[KEY_PROPERTIES],
        "sheets",
        INCLUDED,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Metadata,
        &[KEY_PROPERTIES],
        "sheet-metadata",
        INCLUDED_COVERAGE_ONLY,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Cell,
        &[KEY_CELLS],
        "cells.values",
        INCLUDED,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::CellProperties,
        &[KEY_CELL_PROPERTIES],
        "cell-properties",
        INCLUDED,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::RowColumn,
        &[
            KEY_ROW_ORDER,
            KEY_COL_ORDER,
            KEY_ROW_HEIGHTS,
            KEY_COL_WIDTHS,
        ],
        "rows-columns",
        INCLUDED,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::RowColumn,
        &[
            KEY_ROW_FORMATS,
            KEY_COL_FORMATS,
            KEY_COL_FORMAT_RANGES,
            KEY_MANUAL_HIDDEN_ROWS,
            KEY_HIDDEN_ROWS,
            KEY_HIDDEN_COLS,
        ],
        "rows-columns",
        unsupported("VERSIONING_UNSUPPORTED_ROW_COLUMN_SCHEMA"),
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Range,
        &[
            KEY_RANGES,
            KEY_RANGE_PAYLOADS,
            KEY_RANGE_FORMATS,
            KEY_RANGE_BINDINGS,
            KEY_MERGES,
        ],
        "ranges",
        unsupported("VERSIONING_UNSUPPORTED_RANGE_SCHEMA"),
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Metadata,
        &[
            KEY_SCHEMAS,
            KEY_PIVOT_TABLES,
            KEY_COMMENTS,
            KEY_FILTERS,
            KEY_FILTER_METADATA_BINDINGS,
            KEY_SPARKLINES,
            KEY_CONDITIONAL_FORMAT,
            KEY_BINDINGS,
            KEY_GROUPING,
            KEY_SORTING,
            KEY_CF_RULES,
            KEY_VALIDATION_RULES,
        ],
        "sheet-metadata",
        unsupported("VERSIONING_UNSUPPORTED_SHEET_METADATA_SCHEMA"),
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Metadata,
        &[
            KEY_FLOATING_OBJECTS,
            KEY_FLOATING_OBJECT_ORDER,
            KEY_FLOATING_OBJECT_GROUPS,
        ],
        "floating-objects",
        opaque("VERSIONING_OPAQUE_FLOATING_OBJECT_SCHEMA"),
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::BridgeOnly,
        &[KEY_GRID_INDEX],
        "identity-bridge",
        INCLUDED_COVERAGE_ONLY,
    );
    push_grid_index_keys(
        records,
        &[
            KEY_GRID_POS_TO_ID,
            KEY_GRID_ID_TO_POS,
            KEY_GRID_ROW_AXIS,
            KEY_GRID_COL_AXIS,
        ],
        "identity-bridge",
        INCLUDED_COVERAGE_ONLY,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::RowColumn,
        &[KEY_FILTER_HIDDEN_ROWS],
        "rows-columns",
        DERIVED,
    );
    push_sheet_keys(
        records,
        SemanticCoverageScope::Range,
        &[KEY_MERGE_BACKUPS],
        "merges",
        DERIVED,
    );
}

fn push_cell_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_cell_keys(records, &[KEY_VALUE], "cells.values", INCLUDED);
    push_cell_keys(
        records,
        &[
            KEY_FORMULA,
            KEY_FORMULA_TEMPLATE,
            KEY_FORMULA_REFS,
            KEY_FORMULA_DYNAMIC_ARRAY,
            KEY_FORMULA_VOLATILE,
            KEY_FORMULA_AGGREGATE,
        ],
        "cells.formulas",
        INCLUDED,
    );
    push_cell_keys(
        records,
        &[
            KEY_FORMULA_METADATA,
            KEY_ARRAY_REF,
            "rt",
            "h",
            "hl",
            "hd",
            "ht",
            "hu",
            "hk",
            "hm",
            "hr",
            "ho",
            "c",
        ],
        "cell-unsupported",
        unsupported("VERSIONING_UNSUPPORTED_CELL_SCHEMA"),
    );
}

fn push_cell_property_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_cell_property_keys(
        records,
        &[
            "ff", "fs", "fc", "bo", "it", "ul", "st", "ha", "va", "wt", "nf", "bg", "lk", "hd",
            "in", "ro", "xi", "ss", "sb", "sf", "rd", "ft", "pt", "pf", "fo", "fw", "qp", "pb",
            "cs", "fy", "ai", "fct", "bct", "pfct", "bd", "gf",
        ],
        "direct-format",
        INCLUDED,
    );
    push_cell_property_keys(
        records,
        &[
            "format",
            "provenance",
            "validation",
            "connection_id",
            "connectionId",
            "s",
            "pv",
            "vl",
            "ci",
            "si",
            "cm",
            "vm",
            "ph",
            "dlv",
            "dateLexicalValue",
            "frt",
            "formulaResultType",
            "ecv",
            "hasEmptyCachedValue",
            "fcp",
            "formulaCacheProvenance",
            "sst",
            "sstIndex",
            "ov",
            "originalValue",
            "isArrayFormula",
            "isCseAnchor",
            "isArrayMember",
            "region",
        ],
        "cell-property-unsupported",
        unsupported("VERSIONING_UNSUPPORTED_CELL_PROPERTY_SCHEMA"),
    );
}

fn push_sheet_metadata_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_sheet_metadata_keys(
        records,
        &[
            KEY_NAME,
            KEY_ROWS,
            KEY_COLS,
            "hidden",
            "veryHidden",
            "visibility",
            "tabColor",
            "frozenRows",
            "frozenCols",
            "frozen",
            "frozenPaneTopLeftCell",
            "showGridlines",
            "showRowHeaders",
            "showColumnHeaders",
            "showFormulas",
            "showZeroValues",
            "protectionDetails",
            "gridlineColor",
            "rightToLeft",
            "zoomScale",
            "defaultRowHeight",
            "defaultColWidth",
            "usedRange",
            "printArea",
            "printTitles",
            "printSettings",
            "splitConfig",
            "hfImages",
            "scrollTopRow",
            "scrollLeftCol",
            "dataValidations",
            "dvDeclaredCount",
            "dvDisablePrompts",
            "dvXWindow",
            "dvYWindow",
            "x14DataValidations",
            "x14DvDeclaredCount",
            "tabSelected",
            "activeCell",
            "sqref",
            "sheetUid",
            "defaultRowDescent",
            "zoomScaleNormal",
            "customHeight",
            "zeroHeight",
            "baseColWidth",
            "outlineLevelRow",
            "outlineLevelCol",
            "enableCalculation",
            "autoFilter",
            "sortState",
            "sheetProperties",
        ],
        "sheet-metadata",
        unsupported("VERSIONING_UNSUPPORTED_SHEET_METADATA_SCHEMA"),
    );
}

fn push_security_records(records: &mut Vec<SemanticCoverageRecord>) {
    push_paths(
        records,
        SemanticCoverageScope::Metadata,
        &[
            "/security/policies",
            "/security/version",
            "/security/templates",
        ],
        "security",
        unsupported("VERSIONING_UNSUPPORTED_SECURITY_SCHEMA"),
        "vc03-schema-security",
    );
}

fn push_workbook_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            SemanticCoverageScope::Workbook,
            format!("/workbook/{key}"),
            owner,
            shape,
            "vc03-schema-workbook",
        );
    }
}

fn push_sheet_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    scope: SemanticCoverageScope,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            scope,
            format!("/sheets/{{sheetId}}/{key}"),
            owner,
            shape,
            "vc03-schema-sheet",
        );
    }
}

fn push_grid_index_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            SemanticCoverageScope::BridgeOnly,
            format!("/sheets/{{sheetId}}/gridIndex/{key}"),
            owner,
            shape,
            "vc03-schema-bridge-only",
        );
    }
}

fn push_cell_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            SemanticCoverageScope::Cell,
            format!("/sheets/{{sheetId}}/cells/{{cellId}}/{key}"),
            owner,
            shape,
            "vc03-schema-cell",
        );
    }
}

fn push_cell_property_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            SemanticCoverageScope::CellProperties,
            format!("/sheets/{{sheetId}}/cellProperties/{{cellId}}/{key}"),
            owner,
            shape,
            "vc03-schema-cell-properties",
        );
    }
}

fn push_sheet_metadata_keys(
    records: &mut Vec<SemanticCoverageRecord>,
    keys: &[&str],
    owner: &'static str,
    shape: CoverageShape,
) {
    for key in keys {
        push_one(
            records,
            SemanticCoverageScope::Metadata,
            format!("/sheets/{{sheetId}}/properties/{key}"),
            owner,
            shape,
            "vc03-schema-sheet-metadata",
        );
    }
}

fn push_paths(
    records: &mut Vec<SemanticCoverageRecord>,
    scope: SemanticCoverageScope,
    paths: &[&str],
    owner: &'static str,
    shape: CoverageShape,
    fixture_id: &'static str,
) {
    for path in paths {
        push_one(records, scope, *path, owner, shape, fixture_id);
    }
}

fn push_one(
    records: &mut Vec<SemanticCoverageRecord>,
    scope: SemanticCoverageScope,
    source_path: impl Into<String>,
    domain_owner: &'static str,
    shape: CoverageShape,
    fixture_id: &'static str,
) {
    let (classification, digest_part, status_effect, diagnostic_code) = shape;
    records.push(SemanticCoverageRecord {
        schema_version: SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION,
        scope,
        source_path: source_path.into(),
        domain_owner,
        classification,
        digest_part,
        status_effect,
        diagnostic_code,
        fixture_id,
    });
}

fn unsupported(diagnostic_code: &'static str) -> CoverageShape {
    (
        SemanticCoverageClassification::UnsupportedDiagnostic,
        SemanticCoverageDigestPart::CoverageOnly,
        SemanticCoverageStatusEffect::Partial,
        Some(diagnostic_code),
    )
}

fn opaque(diagnostic_code: &'static str) -> CoverageShape {
    (
        SemanticCoverageClassification::OpaqueDigest,
        SemanticCoverageDigestPart::Opaque,
        SemanticCoverageStatusEffect::Partial,
        Some(diagnostic_code),
    )
}
