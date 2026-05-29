use std::collections::{HashMap, HashSet};

use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{relationship_owner_from_rels_path, resolve_relationship_target};
use crate::write::package_ownership::AuxiliaryPackagePartPolicy;
use crate::zip::XlsxArchive;

#[derive(Debug, Clone, Default)]
pub struct OpcPackageInventory {
    pub entries: Vec<OpcPackageEntry>,
    pub relationships: Vec<OpcInventoryRelationship>,
    pub diagnostics: Vec<OpcInventoryDiagnostic>,
    pub profile: OpcPackageProfile,
    pub profile_evidence: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct OpcPackageEntry {
    pub original_path: String,
    pub normalized_path: String,
    pub content_type: Option<String>,
    pub is_relationship_sidecar: bool,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Default)]
pub struct OpcInventoryRelationship {
    pub owner: Option<String>,
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub target_mode: Option<String>,
    pub resolved_target: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct OpcInventoryDiagnostic {
    pub code: &'static str,
    pub message: String,
    pub part: Option<String>,
    pub relationship_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpcPackageProfile {
    #[default]
    Unknown,
    Transitional,
    Strict,
    MixedInvalid,
}

impl OpcPackageProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "Unknown",
            Self::Transitional => "Transitional",
            Self::Strict => "Strict",
            Self::MixedInvalid => "MixedInvalid",
        }
    }
}

pub fn build_opc_package_inventory(
    archive: &XlsxArchive<'_>,
    content_type_defaults: &[(String, String)],
    content_type_overrides: &[(String, String)],
) -> OpcPackageInventory {
    let mut inventory = OpcPackageInventory::default();
    let package_paths: HashSet<String> = archive
        .entries()
        .iter()
        .filter(|entry| !entry.name.ends_with('/'))
        .map(|entry| normalize_inventory_path(&entry.name))
        .collect();

    for entry in archive.entries() {
        if entry.name.ends_with('/') {
            continue;
        }
        let normalized_path = normalize_inventory_path(&entry.name);
        let is_relationship_sidecar = normalized_path == "_rels/.rels"
            || (normalized_path.ends_with(".rels") && normalized_path.contains("/_rels/"));
        inventory.entries.push(OpcPackageEntry {
            original_path: entry.name.clone(),
            normalized_path: normalized_path.clone(),
            content_type: content_type_for_path(
                &normalized_path,
                content_type_defaults,
                content_type_overrides,
            ),
            is_relationship_sidecar,
            bytes: imported_inert_part_bytes(
                archive,
                &entry.name,
                &normalized_path,
                is_relationship_sidecar,
            ),
        });

        if is_relationship_sidecar {
            collect_relationship_sidecar(archive, &mut inventory, &normalized_path, &package_paths);
        }
        collect_disposition_diagnostic(&mut inventory, &normalized_path);
    }

    collect_content_type_diagnostics(&mut inventory, content_type_overrides, &package_paths);
    classify_profile(&mut inventory);
    inventory
        .entries
        .sort_by(|a, b| a.normalized_path.cmp(&b.normalized_path));
    inventory
        .relationships
        .sort_by(|a, b| a.owner.cmp(&b.owner).then(a.id.cmp(&b.id)));
    inventory
}

fn collect_disposition_diagnostic(inventory: &mut OpcPackageInventory, path: &str) {
    if is_digital_signature_path(path) {
        inventory.diagnostics.push(OpcInventoryDiagnostic {
            code: "digital_signature_dropped",
            message: format!("digital signature package content is invalidated by rewrite: {path}"),
            part: Some(path.to_string()),
            relationship_id: None,
        });
        return;
    }
    match crate::write::package_ownership::auxiliary_package_part_policy(path) {
        Some(AuxiliaryPackagePartPolicy::ActiveForbidden) => {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "active_content_dropped",
                message: format!(
                    "active package content is not eligible for opaque replay: {path}"
                ),
                part: Some(path.to_string()),
                relationship_id: None,
            });
        }
        Some(AuxiliaryPackagePartPolicy::ActiveQuarantined) => {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "active_content_quarantined",
                message: format!(
                    "active package content is preserved without interpretation or execution: {path}"
                ),
                part: Some(path.to_string()),
                relationship_id: None,
            });
        }
        Some(AuxiliaryPackagePartPolicy::UnsupportedNeedsModel) => {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "unsupported_needs_model_dropped",
                message: format!("package part requires typed modeling before export: {path}"),
                part: Some(path.to_string()),
                relationship_id: None,
            });
        }
        Some(AuxiliaryPackagePartPolicy::DiagnosticsOnly) => {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "diagnostics_only_dropped",
                message: format!("package part is tracked for diagnostics only: {path}"),
                part: Some(path.to_string()),
                relationship_id: None,
            });
        }
        _ => {}
    }
}

fn collect_relationship_sidecar(
    archive: &XlsxArchive<'_>,
    inventory: &mut OpcPackageInventory,
    rels_path: &str,
    package_paths: &HashSet<String>,
) {
    let owner = relationship_owner_from_rels_path(rels_path);
    if rels_path != "_rels/.rels"
        && owner
            .as_ref()
            .is_some_and(|owner_path| !package_paths.contains(owner_path))
    {
        inventory.diagnostics.push(OpcInventoryDiagnostic {
            code: "invalid_relationship_owner",
            message: format!("relationship sidecar has no package owner: {rels_path}"),
            part: Some(rels_path.to_string()),
            relationship_id: None,
        });
    }

    let Ok(bytes) = archive.read_file(rels_path) else {
        return;
    };
    let mut ids = HashSet::new();
    for rel in parse_all_rels(&bytes) {
        if !ids.insert(rel.id.clone()) {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "duplicate_relationship_id",
                message: format!("duplicate relationship id {} in {rels_path}", rel.id),
                part: Some(rels_path.to_string()),
                relationship_id: Some(rel.id.clone()),
            });
        }
        let is_external = rel
            .target_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("External"));
        if rel
            .target_mode
            .as_deref()
            .is_some_and(|mode| !mode.eq_ignore_ascii_case("External"))
        {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "invalid_target_mode",
                message: format!("invalid TargetMode for relationship {}", rel.id),
                part: Some(rels_path.to_string()),
                relationship_id: Some(rel.id.clone()),
            });
        }
        let resolved_target = if is_external {
            None
        } else {
            match resolve_relationship_target(owner.as_deref(), &rel.target) {
                Ok(path) => {
                    if !package_paths.contains(&path) {
                        inventory.diagnostics.push(OpcInventoryDiagnostic {
                            code: "missing_internal_target",
                            message: format!("relationship {} targets missing part {path}", rel.id),
                            part: Some(rels_path.to_string()),
                            relationship_id: Some(rel.id.clone()),
                        });
                    }
                    Some(path)
                }
                Err(_) => {
                    inventory.diagnostics.push(OpcInventoryDiagnostic {
                        code: "invalid_internal_target",
                        message: format!(
                            "relationship {} has invalid target {}",
                            rel.id, rel.target
                        ),
                        part: Some(rels_path.to_string()),
                        relationship_id: Some(rel.id.clone()),
                    });
                    None
                }
            }
        };
        if is_digital_signature_relationship(&rel.rel_type) {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "digital_signature_dropped",
                message: format!(
                    "digital signature relationship {} is invalidated by rewrite",
                    rel.id
                ),
                part: Some(rels_path.to_string()),
                relationship_id: Some(rel.id.clone()),
            });
        }
        inventory.relationships.push(OpcInventoryRelationship {
            owner: owner.clone(),
            id: rel.id,
            relationship_type: rel.rel_type,
            target: rel.target,
            target_mode: rel.target_mode,
            resolved_target,
        });
    }
}

fn imported_inert_part_bytes(
    archive: &XlsxArchive<'_>,
    original_path: &str,
    normalized_path: &str,
    is_relationship_sidecar: bool,
) -> Option<Vec<u8>> {
    if normalized_path == "[Content_Types].xml" || is_relationship_sidecar {
        return None;
    }
    if crate::write::package_ownership::auxiliary_package_part_policy(normalized_path)
        != Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary)
    {
        return None;
    }
    archive.read_file_verbatim(original_path).ok()
}

fn is_digital_signature_path(path: &str) -> bool {
    path == "_xmlsignatures/origin.sigs" || path.starts_with("_xmlsignatures/sig")
}

fn is_digital_signature_relationship(rel_type: &str) -> bool {
    rel_type
        == "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin"
        || rel_type
            == "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature"
        || rel_type.contains("/digital-signature/")
}

fn collect_content_type_diagnostics(
    inventory: &mut OpcPackageInventory,
    content_type_overrides: &[(String, String)],
    package_paths: &HashSet<String>,
) {
    for (part_name, _) in content_type_overrides {
        let normalized = normalize_inventory_path(part_name);
        if !package_paths.contains(&normalized) {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "content_type_override_missing_part",
                message: format!("content type override targets missing part {normalized}"),
                part: Some(normalized),
                relationship_id: None,
            });
        }
    }
    let entries = inventory.entries.clone();
    for entry in entries {
        if entry.is_relationship_sidecar || entry.normalized_path == "[Content_Types].xml" {
            continue;
        }
        if entry.content_type.is_none() {
            inventory.diagnostics.push(OpcInventoryDiagnostic {
                code: "missing_content_type",
                message: format!(
                    "package part has no content type: {}",
                    entry.normalized_path
                ),
                part: Some(entry.normalized_path),
                relationship_id: None,
            });
        }
    }
}

fn classify_profile(inventory: &mut OpcPackageInventory) {
    let mut transitional = false;
    let mut strict = false;
    for rel in &inventory.relationships {
        if rel
            .relationship_type
            .contains("schemas.openxmlformats.org/officeDocument/2006/relationships")
        {
            transitional = true;
            inventory.profile_evidence.push(format!(
                "transitional relationship {}",
                rel.relationship_type
            ));
        }
        if rel
            .relationship_type
            .contains("purl.oclc.org/ooxml/officeDocument/relationships")
        {
            strict = true;
            inventory
                .profile_evidence
                .push(format!("strict relationship {}", rel.relationship_type));
        }
    }
    inventory.profile = match (transitional, strict) {
        (true, true) => OpcPackageProfile::MixedInvalid,
        (true, false) => OpcPackageProfile::Transitional,
        (false, true) => OpcPackageProfile::Strict,
        (false, false) => OpcPackageProfile::Unknown,
    };
    inventory.profile_evidence.sort();
    inventory.profile_evidence.dedup();
}

fn content_type_for_path(
    path: &str,
    defaults: &[(String, String)],
    overrides: &[(String, String)],
) -> Option<String> {
    overrides
        .iter()
        .find(|(part_name, _)| normalize_inventory_path(part_name) == path)
        .map(|(_, content_type)| content_type.clone())
        .or_else(|| {
            path.rsplit_once('.').and_then(|(_, extension)| {
                defaults
                    .iter()
                    .find(|(default_extension, _)| {
                        default_extension.eq_ignore_ascii_case(extension)
                    })
                    .map(|(_, content_type)| content_type.clone())
            })
        })
}

pub fn normalize_inventory_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches('/').to_string()
}

pub fn relationships_by_owner(
    inventory: &OpcPackageInventory,
) -> HashMap<String, Vec<OpcInventoryRelationship>> {
    let mut by_owner: HashMap<String, Vec<OpcInventoryRelationship>> = HashMap::new();
    for rel in &inventory.relationships {
        if let Some(owner) = &rel.owner {
            by_owner.entry(owner.clone()).or_default().push(rel.clone());
        }
    }
    by_owner
}
