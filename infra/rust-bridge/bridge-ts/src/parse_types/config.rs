use std::collections::HashMap;

use crate::types::TsType;

/// Configuration for type generation.
#[derive(Debug, Clone, Default)]
pub struct TypeGenConfig {
    /// Map from Rust type name (or path) to a fixed TsType.
    ///
    /// Checked by both last path segment (e.g. `"FiniteF64"`) and full
    /// qualified path (e.g. `"serde_json::Value"`).
    pub external_type_map: HashMap<String, TsType>,

    /// Default rename rule applied when a **struct** has no explicit
    /// `#[serde(rename_all = "...")]`. For example, `Some("camelCase".into())`
    /// makes all struct fields camelCase by default. An explicit `rename_all`
    /// on the container always takes precedence.
    ///
    /// **Not applied to enum variants.** Enum variant names follow serde's
    /// default behavior (preserve original casing) unless the enum itself has
    /// an explicit `#[serde(rename_all)]`. This matches serde semantics:
    /// struct fields are typically `snake_case` needing conversion, while enum
    /// variants are `PascalCase` and serialized as-is by default.
    pub default_rename_all: Option<String>,
}
