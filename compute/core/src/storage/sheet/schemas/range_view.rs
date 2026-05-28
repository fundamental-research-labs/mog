use super::{RangeSchema, ValidationSpec};

pub(super) fn range_schema_id_for(spec: &ValidationSpec, idx: usize) -> String {
    spec.uid
        .as_ref()
        .filter(|u| !u.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("rs-{idx}"))
}

pub(super) fn spec_to_range_schema(spec: &ValidationSpec, id: String) -> Option<RangeSchema> {
    spec.to_range_schema(id)
}
