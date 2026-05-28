use crate::zip::ZipError;

#[derive(Debug, Default)]
pub(super) struct StreamingUtf8Validator {
    pending: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ValidatedChunk {
    pub(super) direct_len: usize,
    pub(super) buffered: bool,
}

impl StreamingUtf8Validator {
    pub(super) fn new() -> Self {
        Self {
            pending: Vec::with_capacity(4),
        }
    }

    pub(super) fn validate_chunk(
        &mut self,
        chunk: &[u8],
        emit_buffer: &mut Vec<u8>,
    ) -> Result<ValidatedChunk, ZipError> {
        emit_buffer.clear();
        if self.pending.is_empty() {
            return match std::str::from_utf8(chunk) {
                Ok(_) => Ok(ValidatedChunk {
                    direct_len: chunk.len(),
                    buffered: false,
                }),
                Err(err) if err.error_len().is_none() => {
                    self.pending.extend_from_slice(&chunk[err.valid_up_to()..]);
                    if self.pending.len() > 3 {
                        Err(ZipError::DataCorruptionDetail(
                            "streaming XML UTF-8 validator retained more than one code point"
                                .to_string(),
                        ))
                    } else {
                        Ok(ValidatedChunk {
                            direct_len: err.valid_up_to(),
                            buffered: false,
                        })
                    }
                }
                Err(err) => Err(ZipError::DataCorruptionDetail(format!(
                    "streaming XML chunk is not valid UTF-8 at byte {}",
                    err.valid_up_to()
                ))),
            };
        }

        emit_buffer.extend_from_slice(&self.pending);
        emit_buffer.extend_from_slice(chunk);
        self.pending.clear();
        match std::str::from_utf8(emit_buffer) {
            Ok(_) => Ok(ValidatedChunk {
                direct_len: 0,
                buffered: true,
            }),
            Err(err) if err.error_len().is_none() => {
                self.pending
                    .extend_from_slice(&emit_buffer[err.valid_up_to()..]);
                emit_buffer.truncate(err.valid_up_to());
                if self.pending.len() > 3 {
                    Err(ZipError::DataCorruptionDetail(
                        "streaming XML UTF-8 validator retained more than one code point"
                            .to_string(),
                    ))
                } else {
                    Ok(ValidatedChunk {
                        direct_len: 0,
                        buffered: true,
                    })
                }
            }
            Err(err) => Err(ZipError::DataCorruptionDetail(format!(
                "streaming XML chunk is not valid UTF-8 at byte {}",
                err.valid_up_to()
            ))),
        }
    }

    pub(super) fn finish(&mut self) -> Result<(), ZipError> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(ZipError::DataCorruptionDetail(
                "streaming XML ended with an incomplete UTF-8 sequence".to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_utf8_validator_valid_split_multibyte_utf8() {
        let mut validator = StreamingUtf8Validator::new();
        let mut buffer = Vec::new();

        let first = validator
            .validate_chunk(&[b'a', 0xe2], &mut buffer)
            .unwrap();
        assert_eq!(first.direct_len, 1);
        assert!(!first.buffered);

        let second = validator
            .validate_chunk(&[0x82, 0xac, b'b'], &mut buffer)
            .unwrap();
        assert_eq!(second.direct_len, 0);
        assert!(second.buffered);
        assert_eq!(buffer, "€b".as_bytes());

        validator.finish().unwrap();
    }

    #[test]
    fn test_streaming_utf8_validator_invalid_utf8() {
        let mut validator = StreamingUtf8Validator::new();
        let mut buffer = Vec::new();

        let result = validator.validate_chunk(&[b'a', 0xff], &mut buffer);

        assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
    }

    #[test]
    fn test_streaming_utf8_validator_incomplete_final_utf8_sequence() {
        let mut validator = StreamingUtf8Validator::new();
        let mut buffer = Vec::new();

        validator
            .validate_chunk(&[b'a', 0xe2, 0x82], &mut buffer)
            .unwrap();

        assert!(matches!(
            validator.finish(),
            Err(ZipError::DataCorruptionDetail(_))
        ));
    }
}
