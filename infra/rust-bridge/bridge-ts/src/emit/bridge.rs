//! Compute bridge emitter.

use crate::types::*;

use super::imports::render_configured_imports;
use super::names::{compute_effective_prefix, method_command_name, to_camel_case};
use super::refs::collect_named_from_type;

/// Classification of how a bridge method should be wrapped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgePattern {
    /// `core.mutate(transport.call(...))` — binary tuple returns `[Uint8Array, MutationResult]`
    Mutate,
    /// `core.query(transport.call(...))` — read methods
    Query,
    /// `transport.call(...)` directly — no docId, no guard
    Pure,
    /// Don't generate (lifecycle, skip(ts_bridge))
    Skip,
}

/// Check if a return type is a binary mutation tuple like `[Uint8Array, MutationResult]`.
pub fn is_binary_mutation_return(ty: &TsType) -> bool {
    matches!(ty, TsType::Tuple(elems) if elems.len() == 2
        && elems[0] == TsType::Uint8Array
        && matches!(&elems[1], TsType::Named(n) if n == "MutationResult"))
}

/// Classify how a bridge method should be wrapped based on its access level and return type.
pub fn classify_bridge_pattern(method: &TsMethod) -> BridgePattern {
    if method.access == MethodAccess::LifecycleCreate {
        return BridgePattern::Skip;
    }
    if method.skip_platforms.iter().any(|p| p == "ts_bridge") {
        return BridgePattern::Skip;
    }
    match method.access {
        MethodAccess::Pure => BridgePattern::Pure,
        MethodAccess::Read => BridgePattern::Query,
        // `LifecycleSubscribe` travels over the wire identically to `Write` — the
        // distinction only matters for the kind manifest. Same return-type
        // dispatch as `Write`.
        MethodAccess::Write | MethodAccess::LifecycleSubscribe => {
            if is_binary_mutation_return(&method.return_type) {
                BridgePattern::Mutate
            } else {
                // Void, Boolean, Uint8Array, other Named types — use Query
                // which is generic and preserves the return type.
                BridgePattern::Query
            }
        }
        MethodAccess::LifecycleCreate => BridgePattern::Skip,
    }
}

/// Compute the bridge interface return type for a method.
///
/// For `Mutate` pattern, unwraps `[Uint8Array, T]` → `T` (the second tuple element).
/// For all other patterns, returns the type as-is.
pub(crate) fn bridge_return_type(method: &TsMethod, pattern: BridgePattern) -> String {
    match pattern {
        BridgePattern::Mutate => {
            if let TsType::Tuple(elems) = &method.return_type
                && elems.len() == 2
            {
                return elems[1].to_ts_string();
            }
            // Fallback (shouldn't happen if classify is correct)
            method.return_type.to_ts_string()
        }
        _ => method.return_type.to_ts_string(),
    }
}

/// Collect all `TsType::Named` references from bridge-eligible methods only.
/// Filters out `"unknown"` and skipped methods. For Mutate methods, collects
/// from the unwrapped return type (second tuple element) rather than the full tuple.
pub(crate) fn collect_named_from_bridge(api: &TsApi) -> std::collections::BTreeSet<String> {
    use std::collections::BTreeSet;
    let mut names = BTreeSet::new();
    for svc in &api.services {
        for method in &svc.methods {
            let pattern = classify_bridge_pattern(method);
            if pattern == BridgePattern::Skip {
                continue;
            }
            for param in &method.params {
                collect_named_from_type(&param.ts_type, &mut names);
            }
            match pattern {
                BridgePattern::Mutate => {
                    // Only collect from the unwrapped type (second tuple element)
                    if let TsType::Tuple(elems) = &method.return_type
                        && elems.len() == 2
                    {
                        collect_named_from_type(&elems[1], &mut names);
                    }
                }
                _ => {
                    collect_named_from_type(&method.return_type, &mut names);
                }
            }
        }
    }
    names.remove("unknown");
    names
}

/// Configuration for the bridge output.
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    /// Import path for `ComputeCore`, e.g. `"./compute-core"`.
    pub core_import_path: String,
    /// The type name for the core object, e.g. `"ComputeCore"`.
    pub core_type_name: String,
    /// The interface name for generated methods, e.g. `"GeneratedBridgeMethods"`.
    pub interface_name: String,
    /// The class name for the generated bridge base, e.g. `"GeneratedBridgeBase"`.
    pub class_name: String,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            core_import_path: "./compute-core".into(),
            core_type_name: "ComputeCore".into(),
            interface_name: "GeneratedBridgeMethods".into(),
            class_name: "GeneratedBridgeBase".into(),
        }
    }
}

/// Generate TypeScript bridge code for a complete API.
///
/// Produces an interface (`GeneratedBridgeMethods`) and a base class
/// (`GeneratedBridgeBase`) that wraps transport calls with `core.mutate()`,
/// `core.query()`, or bare `transport.call()`.
pub fn emit_bridge(
    api: &TsApi,
    imports: Option<&ImportConfig>,
    bridge_config: Option<&BridgeConfig>,
) -> String {
    let config = bridge_config.cloned().unwrap_or_default();
    let mut out = String::new();

    out.push_str("// Auto-generated by bridge-ts. Do not edit.\n\n");
    out.push_str("import type { BridgeTransport } from '@rust-bridge/client';\n");
    out.push_str(&format!(
        "import type {{ {} }} from '{}';\n",
        config.core_type_name, config.core_import_path
    ));

    if let Some(import_config) = imports {
        let referenced = collect_named_from_bridge(api);
        out.push_str(&render_configured_imports(
            import_config,
            &referenced,
            "the bridge API",
        ));
    }

    out.push('\n');

    // --- Interface ---
    out.push_str("/**\n");
    out.push_str(" * Generated bridge methods.\n");
    out.push_str(
        " * Each method wraps transport.call() with the appropriate bridge scaffolding.\n",
    );
    out.push_str(" */\n");
    out.push_str(&format!("export interface {} {{\n", config.interface_name));

    for svc in &api.services {
        let effective_prefix = compute_effective_prefix(svc);
        for method in &svc.methods {
            let pattern = classify_bridge_pattern(method);
            if pattern == BridgePattern::Skip {
                continue;
            }
            out.push_str(&emit_bridge_interface_method(method, pattern));
        }
        let _ = effective_prefix; // used only in factory below
    }

    out.push_str("}\n\n");

    // --- Base class ---
    out.push_str(&format!(
        "export class {} implements {} {{\n",
        config.class_name, config.interface_name
    ));
    out.push_str(&format!("  readonly core: {};\n\n", config.core_type_name));
    out.push_str(&format!(
        "  constructor(core: {}) {{\n    this.core = core;\n  }}\n\n",
        config.core_type_name
    ));

    for svc in &api.services {
        let effective_prefix = compute_effective_prefix(svc);
        for method in &svc.methods {
            let pattern = classify_bridge_pattern(method);
            if pattern == BridgePattern::Skip {
                continue;
            }
            out.push_str(&emit_bridge_class_method(
                svc,
                method,
                &effective_prefix,
                pattern,
            ));
        }
    }

    out.push_str("}\n");

    out
}

/// Emit one method signature in the bridge interface (no key param).
fn emit_bridge_interface_method(method: &TsMethod, pattern: BridgePattern) -> String {
    let camel_name = to_camel_case(&method.rust_name);
    let return_ts = bridge_return_type(method, pattern);

    let params: Vec<String> = method
        .params
        .iter()
        .map(|p| {
            format!(
                "{}: {}",
                to_camel_case(&p.rust_name),
                p.ts_type.to_ts_string()
            )
        })
        .collect();

    let params_str = params.join(", ");

    format!("  {camel_name}({params_str}): Promise<{return_ts}>;\n")
}

/// Emit one method in the bridge base class.
pub fn emit_bridge_class_method(
    svc: &TsService,
    method: &TsMethod,
    effective_prefix: &str,
    pattern: BridgePattern,
) -> String {
    let camel_name = to_camel_case(&method.rust_name);
    let command_name = method_command_name(effective_prefix, &method.rust_name);

    // Build parameter list with types (no key param — bridge hides it)
    let params: Vec<String> = method
        .params
        .iter()
        .map(|p| {
            format!(
                "{}: {}",
                to_camel_case(&p.rust_name),
                p.ts_type.to_ts_string()
            )
        })
        .collect();
    let params_str = params.join(", ");

    // Return type: unwrapped for Mutate (core.mutate strips the Uint8Array), raw otherwise
    let return_ts = bridge_return_type(method, pattern);
    // Wire type for transport.call<T>: the actual Rust return type.
    // - Mutate: [Uint8Array, MutationResult] (raw binary tuple)
    // - Query/Pure: pass-through, <T> = return type
    let wire_type = method.return_type.to_ts_string();

    // Build args object — inject docId for non-pure methods
    let mut args = Vec::new();
    if pattern != BridgePattern::Pure
        && let Some(key) = &svc.key
    {
        let camel_key = to_camel_case(&key.param_name);
        args.push(format!("{}: this.core.{}", camel_key, camel_key));
    }
    for p in &method.params {
        args.push(to_camel_case(&p.rust_name));
    }

    let args_str = if args.is_empty() {
        "{}".to_string()
    } else {
        format!("{{ {} }}", args.join(", "))
    };

    let call_expr = format!("this.core.transport.call<{wire_type}>('{command_name}', {args_str})");

    let body = match pattern {
        BridgePattern::Mutate => format!("this.core.mutate({})", call_expr),
        BridgePattern::Query => format!("this.core.query({})", call_expr),
        BridgePattern::Pure => call_expr,
        BridgePattern::Skip => unreachable!(),
    };

    format!("  {camel_name}({params_str}): Promise<{return_ts}> {{\n    return {body};\n  }}\n\n")
}
