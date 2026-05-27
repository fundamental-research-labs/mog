//! Bridge method kind manifest emitter.

use crate::types::*;

use super::bridge::{BridgePattern, classify_bridge_pattern};
use super::names::to_camel_case;

/// Map a `MethodAccess` to its TS-bridge "kind" string used in the kind manifest.
///
/// Returns `None` for accesses that don't appear on the generated bridge
/// interface (currently `LifecycleCreate`, which is skipped from emission).
pub fn method_access_to_kind(access: MethodAccess) -> Option<&'static str> {
    match access {
        MethodAccess::Pure => Some("read"),
        MethodAccess::Read => Some("read"),
        MethodAccess::Write => Some("write"),
        MethodAccess::LifecycleSubscribe => Some("lifecycle"),
        MethodAccess::LifecycleCreate => None,
    }
}

/// Emit a `manifest.gen.ts` file mapping each generated bridge method to its
/// kind tag (`'read' | 'write' | 'lifecycle'`).
///
/// Entries are emitted in the same declaration order as `compute-bridge.gen.ts`
/// (service iteration order, then method iteration order within each service)
/// so the two files diff together. Methods skipped from the bridge (lifecycle
/// constructors, `#[bridge::skip(ts_bridge)]`) are also skipped from the
/// manifest. Method names use the camelCase TS form, matching the bridge
/// interface.
pub fn emit_kind_manifest(api: &TsApi) -> String {
    let mut entries: Vec<(String, &'static str)> = Vec::new();
    for svc in &api.services {
        for method in &svc.methods {
            let pattern = classify_bridge_pattern(method);
            if pattern == BridgePattern::Skip {
                continue;
            }
            let kind = match method_access_to_kind(method.access) {
                Some(k) => k,
                None => continue,
            };
            let camel_name = to_camel_case(&method.rust_name);
            entries.push((camel_name, kind));
        }
    }

    let mut out = String::new();
    out.push_str("// AUTO-GENERATED FILE — DO NOT EDIT.\n");
    out.push_str("// Regenerate via: pnpm generate:bridge\n");
    out.push_str("//\n");
    out.push_str("// Source of truth: `MethodAccess` on each `#[bridge::*]` method\n");
    out.push_str("// in compute-core. Methods tagged `#[bridge::write(kind = \"subscribe\")]`\n");
    out.push_str("// are surfaced here as `'lifecycle'` (subscription register/unregister).\n\n");

    out.push_str("export type BridgeMethodKind = 'read' | 'write' | 'lifecycle';\n\n");

    out.push_str(
        "export const BRIDGE_METHOD_KIND: Readonly<Record<string, BridgeMethodKind>> = Object.freeze({\n",
    );
    for (name, kind) in &entries {
        out.push_str(&format!("  {}: '{}',\n", name, kind));
    }
    out.push_str("});\n");

    out
}
