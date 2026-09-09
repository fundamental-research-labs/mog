use serde::{Deserialize, Serialize};

pub const ANNOTATION_SCHEMA_VERSION: u32 = 1;
pub const ANNOTATION_FINGERPRINT_CANONICALIZER: &str = "mog.annotation-fingerprint.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationStatus {
    Fresh,
    Stale,
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationFingerprintProfile {
    CellFormula,
    CellValue,
    CellText,
    CellBlank,
    TableSchema,
    TableShape,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationFingerprint {
    pub profile: AnnotationFingerprintProfile,
    pub canonicalizer: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRecord<Anchor = String> {
    pub schema_version: u32,
    pub id: String,
    pub anchor_id: Anchor,
    pub text: String,
    pub status: AnnotationStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_reason: Option<String>,
    pub fingerprint: AnnotationFingerprint,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<u64>,
}

impl<Anchor> AnnotationRecord<Anchor> {
    pub(crate) fn map_anchor<T>(self, map: impl FnOnce(Anchor) -> T) -> AnnotationRecord<T> {
        AnnotationRecord {
            schema_version: self.schema_version,
            id: self.id,
            anchor_id: map(self.anchor_id),
            text: self.text,
            status: self.status,
            stale_reason: self.stale_reason,
            fingerprint: self.fingerprint,
            created_at: self.created_at,
            updated_at: self.updated_at,
            checked_at: self.checked_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDeleteResult {
    pub anchor_id: String,
    pub removed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation: Option<AnnotationRecord>,
}

impl compute_security::RedactMaybe for AnnotationFingerprint {
    fn redact(&mut self, level: compute_security::AccessLevel) {
        if level < compute_security::AccessLevel::Read {
            self.hash.clear();
        }
    }
}

impl compute_security::RedactMaybe for AnnotationRecord {
    fn redact(&mut self, level: compute_security::AccessLevel) {
        if level < compute_security::AccessLevel::Read {
            self.text.redact(level);
            self.stale_reason = None;
            self.fingerprint.redact(level);
        }
    }
}

impl compute_security::RedactMaybe for AnnotationDeleteResult {
    fn redact(&mut self, level: compute_security::AccessLevel) {
        self.annotation.redact(level);
    }
}
