//! Writer-side OPC package graph construction.
//!
//! The graph records emitted parts and relationships before XML writers render
//! relationship IDs. Existing ZIP assembly can consume the resolved graph while
//! feature writers migrate off ad-hoc relationship/content-type construction.

use std::collections::{HashMap, HashSet};

use super::relationships::{Relationship, RelationshipManager};
use super::write_error::{PackageIntegrityIssue, WriteError};
use super::{
    CONTENT_TYPE_CTRL_PROP, CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES,
    CT_DRAWING, CT_EMF, CT_EXTENDED_PROPERTIES, CT_GIF, CT_JPEG, CT_METADATA, CT_PIVOT_CACHE,
    CT_PIVOT_TABLE, CT_PNG, CT_PRINTER_SETTINGS, CT_RELATIONSHIPS, CT_SHARED_STRINGS, CT_STYLES,
    CT_TABLE, CT_TABLE_SINGLE_CELLS, CT_THEME, CT_VOLATILE_DEPENDENCIES, CT_WMF, CT_WORKBOOK,
    CT_WORKSHEET, CT_XML, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES,
    REL_CTRL_PROP, REL_CUSTOM_PROPERTIES, REL_DRAWING, REL_EXTENDED_PROPERTIES, REL_EXTERNAL_LINK,
    REL_HYPERLINK, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT, REL_PERSON, REL_PIVOT_CACHE,
    REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_SHARED_STRINGS, REL_STYLES, REL_TABLE,
    REL_TABLE_SINGLE_CELLS, REL_THEME, REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET,
};
use crate::domain::content_types::write::{
    CT_CHART_COLOR_STYLE, CT_CHART_STYLE, CT_TIMELINE, CT_TIMELINE_CACHE, ContentTypesManager,
};
use crate::write::package_ownership::AuxiliaryPackagePartPolicy;

mod builder;
mod hints;
mod modeled_workbook;
mod opaque;
mod paths;
mod register;
mod resolution;
mod resolved;
#[cfg(test)]
mod tests;
mod types;
mod validation;

pub use builder::PackageGraphBuilder;
pub use modeled_workbook::{
    ModeledWorkbookGraphOptions, build_modeled_workbook_graph,
    build_modeled_workbook_graph_builder, modeled_part,
};
pub use paths::part_relationships_path;
pub use register::*;
pub use types::{
    PackageOwner, PackagePart, PackagePartKind, PackagePartPath, PackageRelationship,
    PackageRelationshipTarget, RegisteredRelationshipKey, RelationshipIdentityHint,
    RelationshipOwnerPath, ResolvedPackageGraph, ResolvedPackageRelationship,
};

pub(super) use hints::*;
pub(super) use opaque::*;
pub(super) use paths::{
    normalize_external_link_part_path, normalize_part_path, owner_part_path_from_rels_path,
    owner_rels_path, relationship_target_part_path, relative_target,
};
pub(super) use resolution::*;
pub(super) use validation::*;

const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";
const REL_PIVOT_CACHE_RECORDS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords";
const REL_PIVOT_CACHE_DEFINITION: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition";
const CT_THREADED_COMMENTS: &str = "application/vnd.ms-excel.threadedcomments+xml";
const CT_VML_DRAWING: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";
const CT_DOC_METADATA_LABEL_INFO: &str = "application/vnd.ms-office.classificationlabels+xml";
const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";
const REL_IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const CT_OLE_OBJECT: &str = "application/vnd.openxmlformats-officedocument.oleObject";
const CT_WORKSHEET_CUSTOM_PROPERTY: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml";
const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";
const CT_SLICER: &str = "application/vnd.ms-excel.slicer+xml";
const CT_SLICER_CACHE: &str = "application/vnd.ms-excel.slicerCache+xml";
const REL_SLICER: &str = "http://schemas.microsoft.com/office/2007/relationships/slicer";
const REL_SLICER_CACHE: &str = "http://schemas.microsoft.com/office/2007/relationships/slicerCache";
const REL_CONNECTIONS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections";
const REL_QUERY_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable";
const CT_CONNECTIONS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
const CT_QUERY_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";
const REL_VOLATILE_DEPENDENCIES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/volatileDependencies";
const CT_FEATURE_PROPERTY_BAG: &str =
    crate::domain::feature_property_bags::FEATURE_PROPERTY_BAG_CONTENT_TYPE;
const REL_FEATURE_PROPERTY_BAG: &str =
    crate::domain::feature_property_bags::FEATURE_PROPERTY_BAG_REL_TYPE;

pub(crate) fn is_external_target_mode(mode: Option<&str>) -> bool {
    mode.is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
}
