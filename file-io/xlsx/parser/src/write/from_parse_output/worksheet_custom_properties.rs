#[derive(Clone)]
pub(super) struct WorksheetCustomProperties {
    pub xml: String,
    pub parts: Vec<WorksheetCustomPropertyPart>,
}

#[derive(Clone)]
pub(super) struct WorksheetCustomPropertyPart {
    pub path: String,
    pub relationship_id_hint: String,
    pub data: Vec<u8>,
}
