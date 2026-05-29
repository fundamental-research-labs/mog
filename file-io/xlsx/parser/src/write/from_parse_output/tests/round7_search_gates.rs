use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn production_source_has_no_legacy_context_entry_points() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut matches = Vec::new();
    let terms = [
        ["Extension", "Preservation"].concat(),
        ["Round", "Trip", "Context"].concat(),
        ["Preserved", "Elements"].concat(),
        ["Preserved", "Xml"].concat(),
        ["set_", "preserved_", "elements"].concat(),
        ["round", "trip::"].concat(),
        ["pub mod ", "round", "trip"].concat(),
        ["pub use ", "round", "trip"].concat(),
    ];
    collect_term_matches(&src_dir, &terms, &mut matches);

    assert!(
        matches.is_empty(),
        "legacy XLSX context entry points must not remain in production source:\n{}",
        matches.join("\n")
    );
}

#[test]
fn roundtrip_module_directory_is_removed() {
    let roundtrip_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/roundtrip");
    assert!(
        !roundtrip_dir.exists(),
        "src/roundtrip must not remain as a production module directory"
    );
}

#[test]
fn review_terms_are_not_old_context_storage_names() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut matches = Vec::new();
    let terms = [
        ["binary_", "passthrough"].concat(),
        ["preserved_", "namespaces"].concat(),
        ["preserved_", "elements"].concat(),
    ];
    collect_term_matches(&src_dir, &terms, &mut matches);

    assert!(
        matches.is_empty(),
        "old context storage names require explicit owner-scoped replacement:\n{}",
        matches.join("\n")
    );
}

#[test]
fn package_owner_policy_has_no_generic_fallback_surface() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut matches = Vec::new();
    let terms = [
        ["Fallback", "Owner", "Policy"].concat(),
        ["FALLBACK", "_OWNER", "_POLICY"].concat(),
        ["fallback", "_owner", "_policies"].concat(),
        ["Opaque", "Fallback", "Policy"].concat(),
        ["opaque", "_fallback", "_policy"].concat(),
    ];
    collect_term_matches(&src_dir, &terms, &mut matches);

    assert!(
        matches.is_empty(),
        "generic package fallback policy surfaces must stay removed; use explicit owner-scoped policies:\n{}",
        matches.join("\n")
    );
}

fn collect_term_matches(dir: &Path, terms: &[String], matches: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_term_matches(&path, terms, matches);
            continue;
        }
        if !is_scanned_rust_source(&path) {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        for (idx, line) in contents.lines().enumerate() {
            if let Some(term) = terms.iter().find(|term| line.contains(term.as_str())) {
                matches.push(format!(
                    "{}:{} contains {}",
                    display_path(&path),
                    idx + 1,
                    term
                ));
            }
        }
    }
}

fn is_scanned_rust_source(path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) == Some("round7_search_gates.rs") {
        return false;
    }
    let relative = display_path(path);
    if relative.contains("/tests/")
        || relative.contains("/testing/")
        || relative.ends_with("/tests.rs")
        || relative.contains("/bin/")
    {
        return false;
    }
    path.extension().and_then(|ext| ext.to_str()) == Some("rs")
}

fn display_path(path: &Path) -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.strip_prefix(&manifest_dir)
        .unwrap_or(path)
        .display()
        .to_string()
}
