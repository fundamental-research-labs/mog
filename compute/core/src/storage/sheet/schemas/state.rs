//! Ordered, typed data-validation definitions and their OOXML container metadata.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredValidation {
    pub id: String,
    pub spec: super::ValidationSpec,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct ValidationState {
    pub rules: Vec<StoredValidation>,
    pub disable_prompts: bool,
    pub x_window: Option<u32>,
    pub y_window: Option<u32>,
    pub declared_count: Option<u32>,
}
impl ValidationState {
    pub fn from_import(sheet: &domain_types::SheetData) -> Self {
        let mut state = Self {
            disable_prompts: sheet.data_validations_disable_prompts,
            x_window: sheet.data_validations_x_window,
            y_window: sheet.data_validations_y_window,
            declared_count: sheet.data_validations_declared_count,
            ..Default::default()
        };
        for (prefix, specs) in [
            ("", &sheet.data_validations),
            ("x14-", &sheet.x14_data_validations),
        ] {
            for (index, spec) in specs.iter().enumerate() {
                let mut id = super::range_view::range_schema_id_for(spec, index);
                if spec.uid.as_deref().unwrap_or_default().is_empty() {
                    id = format!("{prefix}{id}");
                }
                state.upsert(id, spec.clone());
            }
        }
        state
    }
    pub fn upsert(&mut self, id: String, spec: super::ValidationSpec) {
        if let Some(entry) = self.rules.iter_mut().find(|entry| entry.id == id) {
            entry.spec = spec;
        } else {
            self.rules.push(StoredValidation { id, spec });
        }
    }
}
