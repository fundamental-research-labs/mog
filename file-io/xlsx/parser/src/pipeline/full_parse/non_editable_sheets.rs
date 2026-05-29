use std::collections::{BTreeSet, VecDeque};

use domain_types::{WorkbookSheetKind, WorkbookSheetPackageInfo};

use crate::domain::workbook::read::parse_all_rels;
use crate::infra::imported_parts::ImportedPackageParts;
use crate::infra::opc::resolve_relationship_target;
use crate::write::package_graph::part_relationships_path;
use crate::zip::XlsxArchive;

pub(super) fn capture_non_editable_sheet_clusters(
    archive: &XlsxArchive<'_>,
    inventory: &[WorkbookSheetPackageInfo],
    imported_parts: &mut ImportedPackageParts,
) {
    let mut pending = VecDeque::new();
    let mut visited = BTreeSet::new();

    for entry in inventory {
        if !is_preservable_non_editable_sheet(entry) {
            continue;
        }
        if let Some(path) = entry.normalized_part_path.as_deref() {
            pending.push_back(path.to_string());
        }
    }

    while let Some(path) = pending.pop_front() {
        let normalized = domain_types::normalize_package_path(&path);
        if !visited.insert(normalized.clone()) || !is_allowed_cluster_part(&normalized) {
            continue;
        }

        if let Ok(bytes) = archive.read_file(&normalized) {
            imported_parts.record(normalized.clone(), bytes);
        } else {
            continue;
        }

        let rels_path = part_relationships_path(&normalized);
        let Ok(rels_bytes) = archive.read_file(&rels_path) else {
            continue;
        };
        imported_parts.record(rels_path, rels_bytes.clone());

        for rel in parse_all_rels(&rels_bytes) {
            if rel
                .target_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
            {
                continue;
            }
            let Ok(target_path) = resolve_relationship_target(Some(&normalized), &rel.target)
            else {
                continue;
            };
            if is_allowed_cluster_part(&target_path) {
                pending.push_back(target_path);
            }
        }
    }
}

fn is_preservable_non_editable_sheet(entry: &WorkbookSheetPackageInfo) -> bool {
    if !matches!(
        entry.kind,
        WorkbookSheetKind::Chartsheet | WorkbookSheetKind::Dialogsheet
    ) || entry.normalized_part_path.is_none()
        || entry
            .target_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
    {
        return false;
    }

    !entry
        .diagnostics
        .iter()
        .any(|diag| !matches!(diag.code.as_str(), "workbook_sheet_unsupported_kind"))
}

fn is_allowed_cluster_part(path: &str) -> bool {
    let path = domain_types::normalize_package_path(path);
    if path.starts_with("xl/chartsheets/") || path.starts_with("xl/dialogsheets/") {
        return path.ends_with(".xml") && !path.contains("/_rels/");
    }
    if path.starts_with("xl/drawings/")
        || path.starts_with("xl/charts/")
        || path.starts_with("xl/media/")
        || path.starts_with("xl/printerSettings/")
    {
        return !path.contains("/_rels/");
    }
    false
}
