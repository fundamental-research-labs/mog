//! ImportConfig validation and rendering helpers.

use std::collections::BTreeSet;

use crate::types::ImportConfig;

pub(crate) fn render_configured_imports(
    config: &ImportConfig,
    referenced: &BTreeSet<String>,
    context: &str,
) -> String {
    let mut configured: BTreeSet<String> = BTreeSet::new();
    for group in &config.groups {
        for ti in &group.types {
            configured.insert(ti.local_name.clone());
        }
    }

    for name in referenced {
        if !configured.contains(name) {
            panic!(
                "bridge-ts: type '{}' is referenced in {} but not mapped in ImportConfig. \
                 Add it to an ImportGroup.",
                name, context
            );
        }
    }

    let mut out = String::new();
    for group in &config.groups {
        let used: Vec<_> = group
            .types
            .iter()
            .filter(|ti| referenced.contains(&ti.local_name))
            .collect();
        if used.is_empty() {
            continue;
        }
        let specs: Vec<String> = used
            .iter()
            .map(|ti| match &ti.imported_name {
                Some(imported) => format!("{} as {}", imported, ti.local_name),
                None => ti.local_name.clone(),
            })
            .collect();
        out.push_str(&format!(
            "import type {{ {} }} from '{}';\n",
            specs.join(", "),
            group.from
        ));
    }
    out
}
