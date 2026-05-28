use super::{SignatureStatus, modules::contains_utf16le};

pub(super) fn detect_signature_status(data: &[u8]) -> SignatureStatus {
    if contains_utf16le(data, "_VBA_PROJECT_CUR") && contains_utf16le(data, "VBASigDataV3") {
        return SignatureStatus::V3Signature;
    }

    if contains_utf16le(data, "VBASigDataAgile") {
        return SignatureStatus::AgileSignature;
    }

    if contains_utf16le(data, "VBASigData") || contains_utf16le(data, "_VBA_PROJECT_CUR") {
        return SignatureStatus::SignaturePresent;
    }

    SignatureStatus::NotSigned
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_utf16le(data: &mut [u8], offset: usize, value: &str) {
        let encoded: Vec<u8> = value.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        data[offset..offset + encoded.len()].copy_from_slice(&encoded);
    }

    #[test]
    fn test_detect_signature_status_not_signed() {
        let data = vec![0u8; 1000];
        assert_eq!(detect_signature_status(&data), SignatureStatus::NotSigned);
    }

    #[test]
    fn test_detect_signature_status_v3() {
        let mut data = vec![0u8; 1000];
        insert_utf16le(&mut data, 100, "_VBA_PROJECT_CUR");
        insert_utf16le(&mut data, 300, "VBASigDataV3");
        assert_eq!(detect_signature_status(&data), SignatureStatus::V3Signature);
    }

    #[test]
    fn test_detect_signature_status_agile() {
        let mut data = vec![0u8; 500];
        insert_utf16le(&mut data, 100, "VBASigDataAgile");
        assert_eq!(
            detect_signature_status(&data),
            SignatureStatus::AgileSignature
        );
    }

    #[test]
    fn test_detect_signature_status_standard_vba_sig_data() {
        let mut data = vec![0u8; 500];
        insert_utf16le(&mut data, 100, "VBASigData");
        assert_eq!(
            detect_signature_status(&data),
            SignatureStatus::SignaturePresent
        );
    }

    #[test]
    fn test_detect_signature_status_standard_project_cur() {
        let mut data = vec![0u8; 500];
        insert_utf16le(&mut data, 100, "_VBA_PROJECT_CUR");
        assert_eq!(
            detect_signature_status(&data),
            SignatureStatus::SignaturePresent
        );
    }

    #[test]
    fn test_detect_signature_status_precedence() {
        let mut data = vec![0u8; 1200];
        insert_utf16le(&mut data, 100, "_VBA_PROJECT_CUR");
        insert_utf16le(&mut data, 300, "VBASigData");
        insert_utf16le(&mut data, 500, "VBASigDataAgile");
        insert_utf16le(&mut data, 800, "VBASigDataV3");
        assert_eq!(detect_signature_status(&data), SignatureStatus::V3Signature);
    }
}
