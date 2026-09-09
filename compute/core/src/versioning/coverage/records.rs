//! Native authority inventory. Exhaustive field patterns make additions require classification.
use super::{
    SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION, SemanticCoverageClassification as Class,
    SemanticCoverageDigestPart as Part, SemanticCoverageRecord, SemanticCoverageScope as Scope,
    SemanticCoverageStatusEffect as Effect,
};
use crate::storage::{engine::ComputeEngine, sheet::SheetMetadata, workbook::WorkbookMetadata};

type Shape = (Class, Part, Effect, Option<&'static str>);
const INCLUDED: Shape = (Class::IncludedAuthored, Part::Authored, Effect::Clean, None);
const INVENTORY: Shape = (
    Class::IncludedAuthored,
    Part::CoverageOnly,
    Effect::Clean,
    None,
);
const DERIVED: Shape = (Class::DerivedExcluded, Part::None, Effect::Clean, None);
const VIEW: Shape = (Class::ViewExcluded, Part::None, Effect::Clean, None);
const UNSUPPORTED: Shape = (
    Class::UnsupportedDiagnostic,
    Part::CoverageOnly,
    Effect::Partial,
    Some("VERSIONING_UNSUPPORTED_NATIVE_DOMAIN"),
);
const OPAQUE: Shape = (
    Class::OpaqueDigest,
    Part::Opaque,
    Effect::Partial,
    Some("VERSIONING_OPAQUE_NATIVE_DOMAIN"),
);

macro_rules! native_fields {
    ($records:expr, $value:expr, $ty:ident, $scope:ident, $prefix:literal;
        $($field:ident => ($owner:literal, $shape:expr)),* $(,)?) => {
        let $ty { $($field: _),* } = $value;
        $(push($records, Scope::$scope, concat!($prefix, stringify!($field)), $owner, $shape);)*
    };
}

pub(super) fn semantic_coverage_records(engine: &ComputeEngine) -> Vec<SemanticCoverageRecord> {
    let mut records = Vec::new();
    push(
        &mut records,
        Scope::TopLevel,
        "/workbook",
        "workbook",
        INVENTORY,
    );
    push(
        &mut records,
        Scope::TopLevel,
        "/sheets",
        "sheets",
        INVENTORY,
    );
    push(
        &mut records,
        Scope::TopLevel,
        "/security/policies",
        "security",
        UNSUPPORTED,
    );
    native_fields!(&mut records, &*engine.storage().metadata, WorkbookMetadata, Workbook, "/workbook/metadata/";
        external_links => ("external-data", OPAQUE),
        scenarios => ("workbook-metadata", UNSUPPORTED),
        custom_cell_styles => ("workbook-metadata", UNSUPPORTED),
        sheet_order => ("sheets", INCLUDED),
        slicers => ("workbook-metadata", UNSUPPORTED),
        timelines => ("workbook-metadata", UNSUPPORTED),
        pivot_specs => ("workbook-metadata", OPAQUE),
        imported_pivot_associations => ("workbook-metadata", OPAQUE),
        pivot_cache_records => ("workbook-metadata", OPAQUE),
        pivot_cache_sources => ("workbook-metadata", OPAQUE),
        table_annotations => ("workbook-metadata", UNSUPPORTED),
        custom_table_styles => ("workbook-metadata", UNSUPPORTED),
        style_palette => ("workbook-metadata", UNSUPPORTED),
        named_ranges => ("named-ranges", INCLUDED),
        settings => ("workbook-metadata", UNSUPPORTED),
        protection => ("workbook-metadata", UNSUPPORTED),
        properties => ("workbook-metadata", UNSUPPORTED),
        views => ("workbook-metadata", VIEW),
        root_namespaces => ("workbook-metadata", UNSUPPORTED),
        custom_views_xml => ("workbook-metadata", VIEW),
        default_slicer_style => ("workbook-metadata", UNSUPPORTED),
        default_pivot_table_style => ("workbook-metadata", UNSUPPORTED),
        imported_default_table_style => ("workbook-metadata", UNSUPPORTED),
        imported_default_pivot_style => ("workbook-metadata", UNSUPPORTED),
        named_slicer_styles => ("workbook-metadata", UNSUPPORTED),
        theme => ("workbook-metadata", UNSUPPORTED),
        document_properties => ("workbook-metadata", UNSUPPORTED),
        extended_properties => ("workbook-metadata", UNSUPPORTED),
        xlsx_metadata => ("workbook-metadata", OPAQUE),
        file_version => ("workbook-metadata", OPAQUE),
        file_sharing => ("workbook-metadata", UNSUPPORTED),
        web_publishing => ("workbook-metadata", UNSUPPORTED),
        shared_string_hints => ("workbook-metadata", DERIVED),
        package_fidelity => ("workbook-metadata", OPAQUE),
        volatile_dependency_part => ("external-data", OPAQUE),
        connections => ("external-data", OPAQUE),
        stylesheet => ("workbook-metadata", UNSUPPORTED),
        persons => ("workbook-metadata", UNSUPPORTED),
        has_persons_part => ("workbook-metadata", UNSUPPORTED),
    );
    // Schema coverage is shared by every sheet; inspect one native value to avoid duplicate rows.
    for metadata in engine.storage().sheet_metadata.values().take(1) {
        native_fields!(&mut records, metadata, SheetMetadata, Metadata, "/sheets/{sheetId}/metadata/";
            floating_objects => ("sheet-metadata", OPAQUE),
            sparklines => ("sheet-metadata", UNSUPPORTED),
            pivots => ("sheet-metadata", UNSUPPORTED),
            column_schemas => ("sheet-metadata", UNSUPPORTED),
            validations => ("sheet-metadata", UNSUPPORTED),
            conditional_formats => ("sheet-metadata", UNSUPPORTED),
            data_bindings => ("sheet-metadata", UNSUPPORTED),
            comments => ("sheet-metadata", UNSUPPORTED),
            cell_annotations => ("sheet-metadata", UNSUPPORTED),
            legacy_comment_authors => ("sheet-metadata", UNSUPPORTED),
            comment_package => ("sheet-metadata", OPAQUE),
            drawing_package => ("sheet-metadata", OPAQUE),
            filters => ("sheet-metadata", UNSUPPORTED),
            filter_bindings => ("sheet-metadata", UNSUPPORTED),
            auto_filter => ("sheet-metadata", UNSUPPORTED),
            sort_state => ("sheet-metadata", UNSUPPORTED),
            cell_properties => ("sheet-metadata", INVENTORY),
            hyperlinks => ("sheet-metadata", UNSUPPORTED),
            merges => ("sheet-metadata", UNSUPPORTED),
            dimensions => ("sheet-metadata", UNSUPPORTED),
            grouping => ("sheet-metadata", UNSUPPORTED),
            name => ("sheets", INCLUDED),
            original_sheet_id => ("sheet-metadata", UNSUPPORTED),
            uid => ("sheet-metadata", UNSUPPORTED),
            visibility => ("sheet-metadata", UNSUPPORTED),
            enable_calculation => ("sheet-metadata", UNSUPPORTED),
            view => ("sheet-metadata", VIEW),
            extra_views => ("sheet-metadata", VIEW),
            views_ext_lst_xml => ("sheet-metadata", VIEW),
            split_config => ("sheet-metadata", VIEW),
            format => ("sheet-metadata", UNSUPPORTED),
            properties => ("sheet-metadata", UNSUPPORTED),
            protection => ("sheet-metadata", UNSUPPORTED),
            gridline_color => ("sheet-metadata", VIEW),
            custom_properties => ("sheet-metadata", UNSUPPORTED),
            print_settings => ("sheet-metadata", UNSUPPORTED),
            page_breaks => ("sheet-metadata", UNSUPPORTED),
            hf_images => ("sheet-metadata", UNSUPPORTED),
            print_areas => ("sheet-metadata", UNSUPPORTED),
            print_titles => ("sheet-metadata", UNSUPPORTED),
            semantic_containers => ("sheet-metadata", OPAQUE),
            root_namespaces => ("sheet-metadata", OPAQUE),
            ext_lst_xml => ("sheet-metadata", OPAQUE),
            dimension_ref => ("sheet-metadata", UNSUPPORTED),
            calc_properties => ("sheet-metadata", UNSUPPORTED),
        );
    }
    for (scope, path, owner, shape) in [
        (Scope::Sheet, "/sheets/{sheetId}/name", "sheets", INCLUDED),
        (
            Scope::Cell,
            "/sheets/{sheetId}/cells/authoredValues",
            "cells.values",
            INCLUDED,
        ),
        (
            Scope::Cell,
            "/sheets/{sheetId}/cells/identityFormulas",
            "cells.formulas",
            INCLUDED,
        ),
        (
            Scope::Cell,
            "/sheets/{sheetId}/cells/generatedValues",
            "cells.values",
            DERIVED,
        ),
        (
            Scope::Cell,
            "/cellMetadata/array_ref",
            "cell-metadata",
            UNSUPPORTED,
        ),
        (
            Scope::Cell,
            "/cellMetadata/formula",
            "cell-metadata",
            UNSUPPORTED,
        ),
        (
            Scope::Cell,
            "/cellMetadata/rich_string",
            "cell-metadata",
            UNSUPPORTED,
        ),
        (
            Scope::CellProperties,
            "/sheets/{sheetId}/metadata/cell_properties/format",
            "direct-formats",
            INCLUDED,
        ),
        (
            Scope::CellProperties,
            "/sheets/{sheetId}/metadata/cell_properties/provenance",
            "cell-properties",
            UNSUPPORTED,
        ),
        (
            Scope::RowColumn,
            "/sheets/{sheetId}/metadata/dimensions/row_heights",
            "rows-columns",
            INCLUDED,
        ),
        (
            Scope::RowColumn,
            "/sheets/{sheetId}/metadata/dimensions/col_widths",
            "rows-columns",
            INCLUDED,
        ),
        (
            Scope::Range,
            "/sheets/{sheetId}/cells/rangeViews",
            "cells.values",
            INCLUDED,
        ),
        (Scope::Range, "/tables", "tables", UNSUPPORTED),
        (Scope::Range, "/dataTables", "data-tables", UNSUPPORTED),
        (
            Scope::Identity,
            "/sheets/{sheetId}/axes/rows",
            "identity",
            INVENTORY,
        ),
        (
            Scope::Identity,
            "/sheets/{sheetId}/axes/columns",
            "identity",
            INVENTORY,
        ),
        (
            Scope::Identity,
            "/sheets/{sheetId}/identities",
            "identity",
            INVENTORY,
        ),
    ] {
        push(&mut records, scope, path, owner, shape);
    }
    records.sort_by(|left, right| {
        (left.scope, &left.source_path, left.domain_owner).cmp(&(
            right.scope,
            &right.source_path,
            right.domain_owner,
        ))
    });
    records
}

fn push(
    records: &mut Vec<SemanticCoverageRecord>,
    scope: Scope,
    path: &str,
    owner: &'static str,
    shape: Shape,
) {
    let (classification, digest_part, status_effect, diagnostic_code) = shape;
    records.push(SemanticCoverageRecord {
        schema_version: SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION,
        scope,
        source_path: path.into(),
        domain_owner: owner,
        classification,
        digest_part,
        status_effect,
        diagnostic_code,
        fixture_id: "native-authority-coverage",
    });
}
