use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

use serde::Deserialize;
use syn::{
    Attribute, Fields, GenericArgument, Item, ItemEnum, ItemStruct, PathArguments, Type, Visibility,
};

const MANIFEST: &str = include_str!("../src/versioning/visibility.toml");
const VERSIONING_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/versioning");

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct VisibilityManifest {
    public_api: Vec<String>,
    kernel_bridge: Vec<String>,
    rust_only: Vec<String>,
}

#[derive(Debug)]
struct VersioningInventory {
    types: BTreeSet<String>,
    dependencies: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ValidationReport {
    parse_error: Option<String>,
    missing: Vec<String>,
    duplicate: Vec<String>,
    unknown: Vec<String>,
    public_api_private_dependencies: Vec<String>,
}

impl ValidationReport {
    fn is_clean(&self) -> bool {
        self == &Self::default()
    }
}

impl fmt::Display for ValidationReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_clean() {
            return write!(f, "versioning visibility manifest is valid");
        }

        if let Some(parse_error) = &self.parse_error {
            writeln!(f, "parse error: {parse_error}")?;
        }
        write_section(f, "missing", &self.missing)?;
        write_section(f, "duplicate", &self.duplicate)?;
        write_section(f, "unknown", &self.unknown)?;
        write_section(
            f,
            "public_api_private_dependencies",
            &self.public_api_private_dependencies,
        )
    }
}

fn write_section(f: &mut fmt::Formatter<'_>, name: &str, values: &[String]) -> fmt::Result {
    if values.is_empty() {
        return Ok(());
    }

    writeln!(f, "{name}:")?;
    for value in values {
        writeln!(f, "  {value}")?;
    }
    Ok(())
}

#[test]
fn versioning_visibility_manifest_is_complete_unique_and_closed() {
    let inventory = versioning_inventory();
    let report = validate_visibility_manifest(MANIFEST, &inventory);

    assert!(report.is_clean(), "{report}");
}

#[test]
fn validator_rejects_missing_serializable_versioning_type() {
    let inventory = versioning_inventory();
    let mut manifest = parse_manifest(MANIFEST).expect("manifest parses");
    remove_entry(&mut manifest.public_api, "ObjectDigest");

    let report = validate_visibility_manifest(&manifest_to_toml(&manifest), &inventory);

    assert!(
        report.missing.contains(&"ObjectDigest".to_string()),
        "{report}"
    );
}

#[test]
fn validator_rejects_duplicate_manifest_entries() {
    let inventory = versioning_inventory();
    let mut manifest = parse_manifest(MANIFEST).expect("manifest parses");
    manifest.kernel_bridge.push("ObjectDigest".to_string());

    let report = validate_visibility_manifest(&manifest_to_toml(&manifest), &inventory);

    assert!(
        report
            .duplicate
            .contains(&"ObjectDigest in public_api, kernel_bridge".to_string()),
        "{report}"
    );
}

#[test]
fn validator_rejects_unknown_manifest_entries() {
    let inventory = versioning_inventory();
    let mut manifest = parse_manifest(MANIFEST).expect("manifest parses");
    manifest
        .rust_only
        .push("UnknownVersioningVisibilityType".to_string());

    let report = validate_visibility_manifest(&manifest_to_toml(&manifest), &inventory);

    assert!(
        report
            .unknown
            .contains(&"UnknownVersioningVisibilityType".to_string()),
        "{report}"
    );
}

#[test]
fn validator_rejects_public_api_dependency_on_private_type() {
    let inventory = versioning_inventory();
    let mut manifest = parse_manifest(MANIFEST).expect("manifest parses");
    move_entry(
        &mut manifest.public_api,
        &mut manifest.kernel_bridge,
        "VersionActorKindWire",
    );

    let report = validate_visibility_manifest(&manifest_to_toml(&manifest), &inventory);

    assert!(
        report
            .public_api_private_dependencies
            .contains(&"VersionAuthorWire -> VersionActorKindWire (kernel_bridge)".to_string()),
        "{report}"
    );
}

fn validate_visibility_manifest(
    manifest_text: &str,
    inventory: &VersioningInventory,
) -> ValidationReport {
    let manifest = match parse_manifest(manifest_text) {
        Ok(manifest) => manifest,
        Err(error) => {
            return ValidationReport {
                parse_error: Some(error.to_string()),
                ..ValidationReport::default()
            };
        }
    };

    let mut report = ValidationReport::default();
    let entries = manifest_entries(&manifest);
    let mut seen: BTreeMap<String, Vec<&'static str>> = BTreeMap::new();
    for (tier, type_name) in entries {
        seen.entry(type_name.to_string()).or_default().push(tier);
    }

    report.missing = inventory
        .types
        .iter()
        .filter(|type_name| !seen.contains_key(*type_name))
        .cloned()
        .collect();

    report.duplicate = seen
        .iter()
        .filter(|(_, tiers)| tiers.len() > 1)
        .map(|(type_name, tiers)| format!("{type_name} in {}", tiers.join(", ")))
        .collect();

    report.unknown = seen
        .keys()
        .filter(|type_name| !inventory.types.contains(*type_name))
        .cloned()
        .collect();

    let public_api: BTreeSet<_> = manifest.public_api.iter().cloned().collect();
    let visibility_by_type = visibility_by_type(&manifest);
    for type_name in &manifest.public_api {
        let Some(dependencies) = inventory.dependencies.get(type_name) else {
            continue;
        };

        for dependency in dependencies {
            if !inventory.types.contains(dependency) || public_api.contains(dependency) {
                continue;
            }

            let visibility = visibility_by_type
                .get(dependency)
                .copied()
                .unwrap_or("unclassified");
            report
                .public_api_private_dependencies
                .push(format!("{type_name} -> {dependency} ({visibility})"));
        }
    }
    report.public_api_private_dependencies.sort();

    report
}

fn parse_manifest(text: &str) -> Result<VisibilityManifest, toml::de::Error> {
    toml::from_str(text)
}

fn manifest_entries(manifest: &VisibilityManifest) -> Vec<(&'static str, &str)> {
    let mut entries = Vec::new();
    entries.extend(
        manifest
            .public_api
            .iter()
            .map(|type_name| ("public_api", type_name.as_str())),
    );
    entries.extend(
        manifest
            .kernel_bridge
            .iter()
            .map(|type_name| ("kernel_bridge", type_name.as_str())),
    );
    entries.extend(
        manifest
            .rust_only
            .iter()
            .map(|type_name| ("rust_only", type_name.as_str())),
    );
    entries
}

fn visibility_by_type(manifest: &VisibilityManifest) -> BTreeMap<String, &'static str> {
    manifest_entries(manifest)
        .into_iter()
        .map(|(tier, type_name)| (type_name.to_string(), tier))
        .collect()
}

fn versioning_inventory() -> VersioningInventory {
    inventory_from_dir(Path::new(VERSIONING_DIR))
}

fn inventory_from_dir(versioning_dir: &Path) -> VersioningInventory {
    let mut all_dependencies = BTreeMap::new();
    let mut entries = std::fs::read_dir(versioning_dir)
        .expect("versioning dir is readable")
        .collect::<Result<Vec<_>, _>>()
        .expect("versioning dir entries are readable");
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }

        let source = std::fs::read_to_string(&path).expect("versioning source is readable");
        scan_source(&source, &mut all_dependencies);
    }

    inventory_from_dependencies(all_dependencies)
}

fn scan_source(source: &str, all_dependencies: &mut BTreeMap<String, BTreeSet<String>>) {
    let file = syn::parse_file(source).expect("versioning module parses");
    scan_items(&file.items, all_dependencies);
}

fn inventory_from_dependencies(
    all_dependencies: BTreeMap<String, BTreeSet<String>>,
) -> VersioningInventory {
    let types = all_dependencies.keys().cloned().collect();
    let dependencies = all_dependencies
        .iter()
        .map(|(type_name, dependencies)| {
            let local_dependencies = dependencies
                .iter()
                .filter(|dependency| all_dependencies.contains_key(*dependency))
                .cloned()
                .collect();
            (type_name.clone(), local_dependencies)
        })
        .collect();

    VersioningInventory {
        types,
        dependencies,
    }
}

fn scan_items(items: &[Item], out: &mut BTreeMap<String, BTreeSet<String>>) {
    for item in items {
        match item {
            Item::Struct(item) if is_public(&item.vis) && derives_serde(&item.attrs) => {
                out.insert(item.ident.to_string(), dependencies_for_struct(item));
            }
            Item::Enum(item) if is_public(&item.vis) && derives_serde(&item.attrs) => {
                out.insert(item.ident.to_string(), dependencies_for_enum(item));
            }
            Item::Mod(item) => {
                if let Some((_, items)) = &item.content {
                    scan_items(items, out);
                }
            }
            _ => {}
        }
    }
}

fn is_public(visibility: &Visibility) -> bool {
    matches!(visibility, Visibility::Public(_))
}

fn derives_serde(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("derive") {
            return false;
        }

        let mut found = false;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("Serialize") || meta.path.is_ident("Deserialize") {
                found = true;
            }
            Ok(())
        });
        found
    })
}

fn dependencies_for_struct(item: &ItemStruct) -> BTreeSet<String> {
    dependencies_for_fields(&item.fields)
}

fn dependencies_for_enum(item: &ItemEnum) -> BTreeSet<String> {
    let mut dependencies = BTreeSet::new();
    for variant in &item.variants {
        dependencies.extend(dependencies_for_fields(&variant.fields));
    }
    dependencies
}

fn dependencies_for_fields(fields: &Fields) -> BTreeSet<String> {
    let mut dependencies = BTreeSet::new();
    for field in fields {
        collect_type_dependencies(&field.ty, &mut dependencies);
    }
    dependencies
}

fn collect_type_dependencies(ty: &Type, out: &mut BTreeSet<String>) {
    match ty {
        Type::Array(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Group(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Paren(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Path(ty) => {
            if let Some(segment) = ty.path.segments.last() {
                out.insert(segment.ident.to_string());
            }
            for segment in &ty.path.segments {
                collect_path_arguments(&segment.arguments, out);
            }
        }
        Type::Ptr(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Reference(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Slice(ty) => collect_type_dependencies(&ty.elem, out),
        Type::Tuple(ty) => {
            for elem in &ty.elems {
                collect_type_dependencies(elem, out);
            }
        }
        _ => {}
    }
}

fn collect_path_arguments(args: &PathArguments, out: &mut BTreeSet<String>) {
    let PathArguments::AngleBracketed(args) = args else {
        return;
    };

    for arg in &args.args {
        match arg {
            GenericArgument::AssocType(arg) => collect_type_dependencies(&arg.ty, out),
            GenericArgument::Constraint(arg) => {
                for bound in &arg.bounds {
                    if let syn::TypeParamBound::Trait(bound) = bound {
                        collect_path_arguments(
                            &bound
                                .path
                                .segments
                                .last()
                                .map(|segment| &segment.arguments)
                                .cloned()
                                .unwrap_or(PathArguments::None),
                            out,
                        );
                    }
                }
            }
            GenericArgument::Type(ty) => collect_type_dependencies(ty, out),
            _ => {}
        }
    }
}

fn remove_entry(entries: &mut Vec<String>, type_name: &str) {
    entries.retain(|entry| entry != type_name);
}

fn move_entry(from: &mut Vec<String>, to: &mut Vec<String>, type_name: &str) {
    remove_entry(from, type_name);
    to.push(type_name.to_string());
}

fn manifest_to_toml(manifest: &VisibilityManifest) -> String {
    format!(
        "public_api = {}\nkernel_bridge = {}\nrust_only = {}\n",
        toml_array(&manifest.public_api),
        toml_array(&manifest.kernel_bridge),
        toml_array(&manifest.rust_only),
    )
}

fn toml_array(values: &[String]) -> String {
    let quoted = values
        .iter()
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("[{quoted}]")
}
