//! Primitive readers for palette binary records.

use super::PaletteBinaryError;

// ---------------------------------------------------------------------------
// Read cursor
// ---------------------------------------------------------------------------

pub(super) struct Cursor<'a> {
    data: &'a [u8],
    pub(super) pos: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    pub(super) fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    pub(super) fn need(&self, n: usize, context: &'static str) -> Result<(), PaletteBinaryError> {
        if self.remaining() < n {
            Err(PaletteBinaryError::BufferTooShort {
                context,
                needed: n,
                available: self.remaining(),
            })
        } else {
            Ok(())
        }
    }

    pub(super) fn read_u8(&mut self, context: &'static str) -> Result<u8, PaletteBinaryError> {
        self.need(1, context)?;
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    pub(super) fn read_u16(&mut self, context: &'static str) -> Result<u16, PaletteBinaryError> {
        self.need(2, context)?;
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    pub(super) fn read_u32(&mut self, context: &'static str) -> Result<u32, PaletteBinaryError> {
        self.need(4, context)?;
        // Invariant: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 4] = self.data[self.pos..self.pos + 4].try_into().unwrap();
        let v = u32::from_le_bytes(bytes);
        self.pos += 4;
        Ok(v)
    }

    pub(super) fn read_i32(&mut self, context: &'static str) -> Result<i32, PaletteBinaryError> {
        self.need(4, context)?;
        // Invariant: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 4] = self.data[self.pos..self.pos + 4].try_into().unwrap();
        let v = i32::from_le_bytes(bytes);
        self.pos += 4;
        Ok(v)
    }

    pub(super) fn read_f64(&mut self, context: &'static str) -> Result<f64, PaletteBinaryError> {
        self.need(8, context)?;
        // Invariant: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 8] = self.data[self.pos..self.pos + 8].try_into().unwrap();
        let v = f64::from_le_bytes(bytes);
        self.pos += 8;
        Ok(v)
    }

    pub(super) fn read_bool(&mut self, context: &'static str) -> Result<bool, PaletteBinaryError> {
        Ok(self.read_u8(context)? != 0)
    }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/// Read a `StrRef` and resolve it against the string pool.
pub(super) fn read_string(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
    context: &'static str,
) -> Result<String, PaletteBinaryError> {
    let offset = cursor.read_u32(context)?;
    let length = cursor.read_u16(context)?;

    let end = offset as usize + length as usize;
    if end > pool_size as usize {
        return Err(PaletteBinaryError::InvalidStringRef {
            offset,
            length,
            pool_size,
        });
    }

    let slice = &pool[offset as usize..end];
    std::str::from_utf8(slice)
        .map(str::to_owned)
        .map_err(|_| PaletteBinaryError::InvalidUtf8 { offset, length })
}
