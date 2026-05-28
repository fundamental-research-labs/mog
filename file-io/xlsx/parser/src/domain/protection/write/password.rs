/// Hash a password using Excel's legacy algorithm (pre-2007).
pub fn hash_password_legacy(password: &str) -> String {
    let bytes = password.as_bytes();

    if bytes.is_empty() {
        return "0000".to_string();
    }

    let mut hash: u16 = 0;

    for (i, &b) in bytes.iter().enumerate() {
        let shift = (i + 1) % 15;
        let rotated = if shift == 0 {
            b as u16
        } else {
            let val = b as u16;
            ((val << shift) | (val >> (15 - shift))) & 0x7FFF
        };
        hash ^= rotated;
    }

    hash ^= bytes.len() as u16;
    hash ^= 0xCE4B;

    format!("{:04X}", hash)
}

/// Generate a random salt for SHA-512 password hashing.
pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    let seed = standalone_unix_nanos();

    let mut state = seed as u64;
    for byte in salt.iter_mut() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        *byte = (state >> 33) as u8;
    }

    salt
}

fn standalone_unix_nanos() -> u128 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() * 1_000_000.0) as u128
    }
}

/// Hash a password using the current SHA-512-shaped placeholder algorithm.
pub fn hash_password_sha512(password: &str, salt: &[u8], spin_count: u32) -> (String, String) {
    let salt_b64 = base64_encode(salt);

    let mut hash_bytes = [0u8; 64];
    let pwd_bytes = password.as_bytes();
    for (i, byte) in hash_bytes.iter_mut().enumerate() {
        let pwd_byte = pwd_bytes.get(i % pwd_bytes.len().max(1)).unwrap_or(&0);
        let salt_byte = salt.get(i % salt.len().max(1)).unwrap_or(&0);
        *byte = pwd_byte
            .wrapping_add(*salt_byte)
            .wrapping_add(((spin_count >> (i % 4 * 8)) & 0xFF) as u8)
            .wrapping_add(i as u8);
    }

    let hash_b64 = base64_encode(&hash_bytes);

    (hash_b64, salt_b64)
}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;

        result.push(ALPHABET[b0 >> 2] as char);
        result.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);

        if chunk.len() > 1 {
            result.push(ALPHABET[((b1 & 0x0F) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(ALPHABET[b2 & 0x3F] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_password_legacy_empty() {
        assert_eq!(hash_password_legacy(""), "0000");
    }

    #[test]
    fn hash_password_legacy_exact_outputs() {
        assert_eq!(hash_password_legacy("password"), "83AF");
        assert_eq!(hash_password_legacy("test"), "CBEB");
        assert_eq!(hash_password_legacy("pass"), "CB83");
    }

    #[test]
    fn hash_password_legacy_consistency() {
        let hash1 = hash_password_legacy("test123");
        let hash2 = hash_password_legacy("test123");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn hash_password_legacy_different() {
        let hash1 = hash_password_legacy("password1");
        let hash2 = hash_password_legacy("password2");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn hash_password_sha512_exact_output() {
        let salt = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let (hash, salt_b64) = hash_password_sha512("password", &salt, 100000);

        assert_eq!(
            hash,
            "Eep5eiAAgHMh+omKMBCQgyH6iYowEJCDMQqZmkAgoJMxCpmaQCCgk0EaqapQMLCjQRqpqlAwsKNRKrm6YEDAsw=="
        );
        assert_eq!(salt_b64, "AQIDBAUGBwgJCgsMDQ4PEA==");
    }

    #[test]
    fn hash_password_sha512_consistency() {
        let salt = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let (hash1, _) = hash_password_sha512("test", &salt, 100000);
        let (hash2, _) = hash_password_sha512("test", &salt, 100000);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn generate_salt_returns_sixteen_bytes() {
        let salt = generate_salt();
        assert_eq!(salt.len(), 16);
    }

    #[test]
    fn base64_encode_vectors() {
        assert_eq!(base64_encode(&[]), "");
        assert_eq!(base64_encode(&[0]), "AA==");
        assert_eq!(base64_encode(&[0, 0]), "AAA=");
        assert_eq!(base64_encode(&[0, 0, 0]), "AAAA");
        assert_eq!(base64_encode(b"Hello"), "SGVsbG8=");
    }
}
