use snapshot_types::versioning::{
    ObjectDigest, VersionRedactionKeySubjectWire, VersionRedactionKeyWire,
    VersionRedactionPolicyWire,
};

const REDACTION_KEY_DOMAIN: &str = "mog.versioning.redaction-key.v1";
const AUTHOR_ID_FIELD: &str = "operation.author.authorId";
const SESSION_ID_FIELD: &str = "operation.author.sessionId";
const PROVIDER_ID_FIELD: &str = "operation.collaboration.providerId";

pub fn deterministic_redaction_key(
    subject: VersionRedactionKeySubjectWire,
    source_field: impl Into<String>,
    raw_value: impl AsRef<str>,
    policy: VersionRedactionPolicyWire,
) -> VersionRedactionKeyWire {
    let source_field = source_field.into();
    let digest = redaction_key_digest(&subject, &source_field, raw_value.as_ref());
    let key_id = format!(
        "redaction-key:{}:sha256:{}",
        subject_label(&subject),
        digest.value
    );
    VersionRedactionKeyWire {
        key_id,
        subject,
        source_field,
        digest,
        policy,
    }
}

pub fn author_id_redaction_key(author_id: impl AsRef<str>) -> VersionRedactionKeyWire {
    deterministic_redaction_key(
        VersionRedactionKeySubjectWire::Author,
        AUTHOR_ID_FIELD,
        author_id,
        VersionRedactionPolicyWire::MetadataOnly,
    )
}

pub fn session_id_redaction_key(session_id: impl AsRef<str>) -> VersionRedactionKeyWire {
    deterministic_redaction_key(
        VersionRedactionKeySubjectWire::Session,
        SESSION_ID_FIELD,
        session_id,
        VersionRedactionPolicyWire::MetadataOnly,
    )
}

pub fn provider_id_redaction_key(provider_id: impl AsRef<str>) -> VersionRedactionKeyWire {
    deterministic_redaction_key(
        VersionRedactionKeySubjectWire::Provider,
        PROVIDER_ID_FIELD,
        provider_id,
        VersionRedactionPolicyWire::MetadataOnly,
    )
}

pub fn debug_field_redaction_key(
    field_name: impl AsRef<str>,
    value: impl AsRef<str>,
) -> VersionRedactionKeyWire {
    deterministic_redaction_key(
        VersionRedactionKeySubjectWire::Debug,
        format!("debug.{}", field_name.as_ref()),
        value,
        VersionRedactionPolicyWire::MetadataOnly,
    )
}

fn redaction_key_digest(
    subject: &VersionRedactionKeySubjectWire,
    source_field: &str,
    raw_value: &str,
) -> ObjectDigest {
    let mut bytes = Vec::new();
    push_component(&mut bytes, REDACTION_KEY_DOMAIN);
    push_component(&mut bytes, subject_label(subject));
    push_component(&mut bytes, source_field);
    push_component(&mut bytes, raw_value);
    ObjectDigest::sha256(&bytes)
}

fn push_component(bytes: &mut Vec<u8>, component: &str) {
    bytes.extend_from_slice(component.len().to_string().as_bytes());
    bytes.push(b':');
    bytes.extend_from_slice(component.as_bytes());
    bytes.push(0);
}

fn subject_label(subject: &VersionRedactionKeySubjectWire) -> &'static str {
    match subject {
        VersionRedactionKeySubjectWire::Author => "author",
        VersionRedactionKeySubjectWire::Session => "session",
        VersionRedactionKeySubjectWire::Provider => "provider",
        VersionRedactionKeySubjectWire::Debug => "debug",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_keys_are_stable_for_supported_sensitive_fields() {
        let author = author_id_redaction_key("ada@example.com");
        let author_again = author_id_redaction_key("ada@example.com");
        let session = session_id_redaction_key("session-123");
        let provider = provider_id_redaction_key("indexeddb-primary");
        let debug = debug_field_redaction_key("payloadPreview", "debug payload");

        assert_eq!(author, author_again);
        assert_eq!(author.source_field, AUTHOR_ID_FIELD);
        assert_eq!(session.source_field, SESSION_ID_FIELD);
        assert_eq!(provider.source_field, PROVIDER_ID_FIELD);
        assert_eq!(debug.source_field, "debug.payloadPreview");

        assert_ne!(author.key_id, session.key_id);
        assert_ne!(author.key_id, provider.key_id);
        assert_ne!(author.key_id, debug.key_id);
        assert!(author.key_id.starts_with("redaction-key:author:sha256:"));
        assert!(session.key_id.starts_with("redaction-key:session:sha256:"));
        assert!(
            provider
                .key_id
                .starts_with("redaction-key:provider:sha256:")
        );
        assert!(debug.key_id.starts_with("redaction-key:debug:sha256:"));

        assert_eq!(
            author.digest.value,
            "2f6d67552e4e9dbbd4fe995c84de98ae0d395653f868d186973a823eb3ea226b"
        );
        assert_eq!(
            session.digest.value,
            "2cf105a1106c9dc2828142ed9ee7d193b08b5ead230c7f55e80b658ef80f6f17"
        );
        assert_eq!(
            provider.digest.value,
            "f0c6c79faa0a54ba26570b435394585491e3979640ef0f9e1ff584792ddc6798"
        );
        assert_eq!(
            debug.digest.value,
            "007968206b859bd96011460c8e41cbe59b3168664426d68dfe69f3e61bdb43ca"
        );
    }

    #[test]
    fn same_raw_value_hashes_differ_by_subject_and_field() {
        let raw_value = "same-sensitive-value";
        let author = deterministic_redaction_key(
            VersionRedactionKeySubjectWire::Author,
            AUTHOR_ID_FIELD,
            raw_value,
            VersionRedactionPolicyWire::MetadataOnly,
        );
        let session = deterministic_redaction_key(
            VersionRedactionKeySubjectWire::Session,
            SESSION_ID_FIELD,
            raw_value,
            VersionRedactionPolicyWire::MetadataOnly,
        );
        let provider = deterministic_redaction_key(
            VersionRedactionKeySubjectWire::Provider,
            PROVIDER_ID_FIELD,
            raw_value,
            VersionRedactionPolicyWire::MetadataOnly,
        );
        let debug = debug_field_redaction_key("sameSensitiveValue", raw_value);

        assert_ne!(author.digest, session.digest);
        assert_ne!(author.digest, provider.digest);
        assert_ne!(author.digest, debug.digest);
        assert_ne!(session.digest, provider.digest);
        assert_ne!(provider.digest, debug.digest);
    }

    #[test]
    fn serialized_redaction_key_omits_raw_sensitive_values() {
        let raw_values = [
            "ada@example.com",
            "session-123",
            "indexeddb-primary",
            "debug payload",
        ];
        let keys = vec![
            author_id_redaction_key(raw_values[0]),
            session_id_redaction_key(raw_values[1]),
            provider_id_redaction_key(raw_values[2]),
            debug_field_redaction_key("payloadPreview", raw_values[3]),
        ];

        let json = serde_json::to_string(&keys).expect("redaction keys serialize");

        for raw_value in raw_values {
            assert!(
                !json.contains(raw_value),
                "serialized redaction key leaked raw value {raw_value}"
            );
        }
        assert!(json.contains("\"sourceField\":\"operation.author.authorId\""));
        assert!(json.contains("\"sourceField\":\"operation.author.sessionId\""));
        assert!(json.contains("\"sourceField\":\"operation.collaboration.providerId\""));
        assert!(json.contains("\"sourceField\":\"debug.payloadPreview\""));
    }
}
