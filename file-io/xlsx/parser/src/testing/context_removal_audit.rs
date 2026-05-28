use std::fs;
use std::path::Path;

#[test]
fn production_sources_do_not_reintroduce_raw_workbook_sheet_xml_replay() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let src = manifest.join("src");
    let blocked = [
        ["Preserved", "Elements"].concat(),
        ["Preserved", "Xml"].concat(),
        ["set_", "preserved_", "elements"].concat(),
    ];

    let mut failures = Vec::new();
    visit_rs_files(&src, &mut |path| {
        if path.ends_with(Path::new("testing/context_removal_audit.rs")) {
            return;
        }
        let Ok(contents) = fs::read_to_string(path) else {
            return;
        };
        for token in &blocked {
            if contents.contains(token) {
                failures.push(format!("{} contains {token}", path.display()));
            }
        }
    });

    assert!(
        failures.is_empty(),
        "raw XML replay APIs must stay out of production sources:\n{}",
        failures.join("\n")
    );
}

fn visit_rs_files(dir: &Path, f: &mut impl FnMut(&Path)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit_rs_files(&path, f);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            f(&path);
        }
    }
}
