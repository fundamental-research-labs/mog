//! Arena allocator for efficient parse-time memory management.
//!
//! This module provides a bump allocator optimized for many small allocations
//! that can be freed in bulk. This is ideal for parsing where we need to allocate
//! many strings and intermediate values that all have the same lifetime.

/// Default chunk size for the arena (64KB).
const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;

/// A bump allocator for efficient parse-time allocations.
///
/// `ParseArena` allocates memory in chunks and hands out slices from the current
/// chunk. Individual allocations cannot be freed; instead, the entire arena is
/// reset or dropped at once. This eliminates per-allocation overhead and improves
/// cache locality.
///
/// # Example
///
/// ```
/// use xlsx_parser::ParseArena;
///
/// let mut arena = ParseArena::new(4096);
///
/// // Allocate some bytes
/// let slice = arena.alloc(100);
/// slice[0] = 42;
///
/// // Copy data into the arena
/// let data = b"Hello, World!";
/// let copied = arena.alloc_copy(data);
/// assert_eq!(copied, data);
///
/// // Reset for reuse
/// arena.reset();
/// ```
#[derive(Debug)]
pub struct ParseArena {
    /// Completed chunks that are full.
    chunks: Vec<Vec<u8>>,
    /// The active chunk for new allocations.
    current_chunk: Vec<u8>,
    /// Size of each new chunk.
    chunk_size: usize,
    /// Current position in the current chunk.
    offset: usize,
}

impl ParseArena {
    /// Creates a new arena with the specified initial capacity.
    ///
    /// The first chunk will be pre-allocated with the given capacity,
    /// and subsequent chunks will use the default chunk size (64KB).
    #[inline]
    pub fn new(initial_capacity: usize) -> Self {
        let capacity = initial_capacity.max(1);
        Self {
            chunks: Vec::new(),
            current_chunk: vec![0u8; capacity],
            chunk_size: DEFAULT_CHUNK_SIZE,
            offset: 0,
        }
    }

    /// Creates a new arena with a custom chunk size.
    ///
    /// Both the initial chunk and subsequent chunks will use the specified size.
    #[inline]
    pub fn with_chunk_size(chunk_size: usize) -> Self {
        let size = chunk_size.max(1);
        Self {
            chunks: Vec::new(),
            current_chunk: vec![0u8; size],
            chunk_size: size,
            offset: 0,
        }
    }

    /// Allocates `size` bytes from the arena.
    ///
    /// Returns a mutable slice to the allocated memory. The memory is
    /// zero-initialized.
    ///
    /// # Panics
    ///
    /// This method never panics under normal conditions. It will always
    /// succeed in allocating the requested memory.
    #[inline]
    pub fn alloc(&mut self, size: usize) -> &mut [u8] {
        if size == 0 {
            return &mut [];
        }

        let remaining = self.current_chunk.len() - self.offset;

        if size <= remaining {
            // Fast path: allocation fits in current chunk
            let start = self.offset;
            self.offset += size;
            &mut self.current_chunk[start..self.offset]
        } else {
            // Slow path: need a new chunk
            self.alloc_slow(size)
        }
    }

    /// Slow path for allocation when current chunk doesn't have enough space.
    #[cold]
    #[inline(never)]
    fn alloc_slow(&mut self, size: usize) -> &mut [u8] {
        // Move current chunk to completed chunks
        let old_chunk = std::mem::take(&mut self.current_chunk);
        self.chunks.push(old_chunk);

        // Determine new chunk size
        let new_chunk_size = if size > self.chunk_size {
            // Very large allocation: create dedicated chunk
            size
        } else {
            self.chunk_size
        };

        // Allocate new chunk
        self.current_chunk = vec![0u8; new_chunk_size];
        self.offset = size;

        &mut self.current_chunk[0..size]
    }

    /// Allocates space and copies `data` into the arena.
    ///
    /// Returns an immutable reference to the copied data.
    #[inline]
    pub fn alloc_copy(&mut self, data: &[u8]) -> &[u8] {
        if data.is_empty() {
            return &[];
        }

        let slice = self.alloc(data.len());
        slice.copy_from_slice(data);
        // Return as immutable reference
        &*slice
    }

    /// Returns the total number of bytes allocated across all chunks.
    ///
    /// This includes both used and unused space in all chunks.
    #[inline]
    pub fn bytes_allocated(&self) -> usize {
        let completed: usize = self.chunks.iter().map(|c| c.len()).sum();
        completed + self.current_chunk.len()
    }

    /// Returns the total number of bytes currently in use.
    ///
    /// This counts only the bytes that have been handed out via `alloc`.
    #[inline]
    pub fn bytes_used(&self) -> usize {
        let completed: usize = self.chunks.iter().map(|c| c.len()).sum();
        completed + self.offset
    }

    /// Resets the arena for reuse without deallocating memory.
    ///
    /// This keeps the first chunk (or the largest chunk if multiple exist)
    /// and drops the rest. The offset is reset to 0.
    #[inline]
    pub fn reset(&mut self) {
        if self.chunks.is_empty() {
            // Just reset offset
            self.offset = 0;
            // Zero out the used portion for safety
            self.current_chunk[..self.offset].fill(0);
        } else {
            // Find the largest chunk to keep
            let mut largest_idx = 0;
            let mut largest_size = self.chunks[0].len();

            for (i, chunk) in self.chunks.iter().enumerate().skip(1) {
                if chunk.len() > largest_size {
                    largest_size = chunk.len();
                    largest_idx = i;
                }
            }

            // Check if current_chunk is largest
            if self.current_chunk.len() >= largest_size {
                // Keep current_chunk, drop all completed chunks
                self.chunks.clear();
            } else {
                // Swap the largest completed chunk to be the current chunk
                let kept = self.chunks.swap_remove(largest_idx);
                self.current_chunk = kept;
                self.chunks.clear();
            }

            self.offset = 0;
        }
    }

    /// Returns the current chunk size configuration.
    #[inline]
    pub fn chunk_size(&self) -> usize {
        self.chunk_size
    }

    /// Returns the number of chunks (including the current one).
    #[inline]
    pub fn chunk_count(&self) -> usize {
        self.chunks.len() + 1
    }
}

impl Default for ParseArena {
    /// Creates a new arena with the default chunk size (64KB).
    #[inline]
    fn default() -> Self {
        Self::with_chunk_size(DEFAULT_CHUNK_SIZE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let arena = ParseArena::new(1024);
        assert_eq!(arena.bytes_allocated(), 1024);
        assert_eq!(arena.bytes_used(), 0);
        assert_eq!(arena.chunk_count(), 1);
    }

    #[test]
    fn test_with_chunk_size() {
        let arena = ParseArena::with_chunk_size(2048);
        assert_eq!(arena.bytes_allocated(), 2048);
        assert_eq!(arena.chunk_size(), 2048);
    }

    #[test]
    fn test_default() {
        let arena = ParseArena::default();
        assert_eq!(arena.bytes_allocated(), DEFAULT_CHUNK_SIZE);
        assert_eq!(arena.chunk_size(), DEFAULT_CHUNK_SIZE);
    }

    #[test]
    fn test_alloc_zero() {
        let mut arena = ParseArena::new(1024);
        let slice = arena.alloc(0);
        assert_eq!(slice.len(), 0);
        assert_eq!(arena.bytes_used(), 0);
    }

    #[test]
    fn test_alloc_small() {
        let mut arena = ParseArena::new(1024);

        let slice1 = arena.alloc(100);
        assert_eq!(slice1.len(), 100);
        assert_eq!(arena.bytes_used(), 100);

        let slice2 = arena.alloc(50);
        assert_eq!(slice2.len(), 50);
        assert_eq!(arena.bytes_used(), 150);

        // Should still be in same chunk
        assert_eq!(arena.chunk_count(), 1);
    }

    #[test]
    fn test_alloc_fills_chunk() {
        let mut arena = ParseArena::new(100);

        // Fill the chunk exactly
        let _slice = arena.alloc(100);
        assert_eq!(arena.bytes_used(), 100);
        assert_eq!(arena.chunk_count(), 1);

        // Next allocation should trigger new chunk
        let _slice2 = arena.alloc(10);
        assert_eq!(arena.chunk_count(), 2);
    }

    #[test]
    fn test_alloc_exceeds_chunk() {
        let mut arena = ParseArena::new(100);

        // Allocate more than remaining space
        let _slice1 = arena.alloc(60);
        let _slice2 = arena.alloc(60); // exceeds remaining 40 bytes

        assert_eq!(arena.chunk_count(), 2);
    }

    #[test]
    fn test_alloc_very_large() {
        let mut arena = ParseArena::with_chunk_size(100);

        // Allocate more than chunk_size
        let slice = arena.alloc(500);
        assert_eq!(slice.len(), 500);

        // Should create a dedicated chunk
        assert_eq!(arena.chunk_count(), 2);
    }

    #[test]
    fn test_alloc_copy_empty() {
        let mut arena = ParseArena::new(1024);
        let copied = arena.alloc_copy(&[]);
        assert_eq!(copied.len(), 0);
        assert_eq!(arena.bytes_used(), 0);
    }

    #[test]
    fn test_alloc_copy() {
        let mut arena = ParseArena::new(1024);
        let data = b"Hello, World!";

        let copied = arena.alloc_copy(data);
        assert_eq!(copied, data);
        assert_eq!(arena.bytes_used(), data.len());
    }

    #[test]
    fn test_alloc_copy_multiple() {
        let mut arena = ParseArena::new(1024);

        // Allocate and immediately verify each one
        {
            let s1 = arena.alloc_copy(b"first");
            assert_eq!(s1, b"first");
        }
        {
            let s2 = arena.alloc_copy(b"second");
            assert_eq!(s2, b"second");
        }
        {
            let s3 = arena.alloc_copy(b"third");
            assert_eq!(s3, b"third");
        }

        // Verify total bytes used
        assert_eq!(arena.bytes_used(), 5 + 6 + 5); // "first" + "second" + "third"
    }

    #[test]
    fn test_alloc_modifiable() {
        let mut arena = ParseArena::new(1024);

        let slice = arena.alloc(10);
        slice[0] = 42;
        slice[9] = 255;

        assert_eq!(slice[0], 42);
        assert_eq!(slice[9], 255);
    }

    #[test]
    fn test_bytes_allocated_single_chunk() {
        let mut arena = ParseArena::new(1024);
        assert_eq!(arena.bytes_allocated(), 1024);

        let _ = arena.alloc(100);
        assert_eq!(arena.bytes_allocated(), 1024); // doesn't change
    }

    #[test]
    fn test_bytes_allocated_multiple_chunks() {
        let mut arena = ParseArena::with_chunk_size(100);

        // First chunk
        let _ = arena.alloc(80);
        assert_eq!(arena.bytes_allocated(), 100);

        // Trigger second chunk
        let _ = arena.alloc(80);
        assert_eq!(arena.bytes_allocated(), 200);
    }

    #[test]
    fn test_bytes_used() {
        let mut arena = ParseArena::with_chunk_size(100);

        let _ = arena.alloc(30);
        assert_eq!(arena.bytes_used(), 30);

        let _ = arena.alloc(40);
        assert_eq!(arena.bytes_used(), 70);

        // Trigger new chunk
        let _ = arena.alloc(50);
        // Previous chunk (100) + new allocation (50)
        assert_eq!(arena.bytes_used(), 100 + 50);
    }

    #[test]
    fn test_reset_single_chunk() {
        let mut arena = ParseArena::new(1024);

        let _ = arena.alloc(500);
        assert_eq!(arena.bytes_used(), 500);

        arena.reset();
        assert_eq!(arena.bytes_used(), 0);
        assert_eq!(arena.bytes_allocated(), 1024); // memory retained
        assert_eq!(arena.chunk_count(), 1);
    }

    #[test]
    fn test_reset_multiple_chunks() {
        let mut arena = ParseArena::with_chunk_size(100);

        // Create multiple chunks
        for _ in 0..5 {
            let _ = arena.alloc(80);
        }
        assert!(arena.chunk_count() > 1);

        arena.reset();
        assert_eq!(arena.bytes_used(), 0);
        assert_eq!(arena.chunk_count(), 1); // only one chunk retained
    }

    #[test]
    fn test_reset_keeps_largest_chunk() {
        let mut arena = ParseArena::with_chunk_size(100);

        // Create regular chunks
        let _ = arena.alloc(80);
        let _ = arena.alloc(80);

        // Create a large dedicated chunk
        let _ = arena.alloc(500);

        arena.reset();

        // Should keep the 500-byte chunk
        assert!(arena.bytes_allocated() >= 500);
        assert_eq!(arena.chunk_count(), 1);
    }

    #[test]
    fn test_reuse_after_reset() {
        let mut arena = ParseArena::new(1024);

        // First use
        let slice1 = arena.alloc(100);
        slice1[0] = 42;

        arena.reset();

        // Second use
        let slice2 = arena.alloc(100);
        // Memory should be reused (same start address)
        assert_eq!(slice2.as_ptr(), arena.current_chunk.as_ptr());
    }

    #[test]
    fn test_many_small_allocations() {
        let mut arena = ParseArena::new(1024);

        // Simulate parsing many small strings
        for i in 0..1000 {
            let data = format!("value_{}", i);
            let copied = arena.alloc_copy(data.as_bytes());
            assert_eq!(copied, data.as_bytes());
        }

        assert!(arena.bytes_used() > 0);
    }

    #[test]
    fn test_chunk_size_minimum() {
        // Ensure minimum chunk size of 1
        let arena = ParseArena::with_chunk_size(0);
        assert_eq!(arena.bytes_allocated(), 1);

        let arena2 = ParseArena::new(0);
        assert_eq!(arena2.bytes_allocated(), 1);
    }

    #[test]
    fn test_allocation_alignment() {
        // Test that allocations work correctly regardless of size
        let mut arena = ParseArena::new(1024);

        for size in [1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64, 127, 128] {
            let slice = arena.alloc(size);
            assert_eq!(slice.len(), size);
        }
    }

    #[test]
    fn test_stress_alternating_sizes() {
        let mut arena = ParseArena::with_chunk_size(256);

        // Alternate between small and medium allocations
        for _ in 0..100 {
            let _ = arena.alloc(10);
            let _ = arena.alloc(100);
            let _ = arena.alloc(1);
            let _ = arena.alloc(50);
        }

        // Should have created multiple chunks
        assert!(arena.chunk_count() > 1);
    }

    #[test]
    fn test_debug_impl() {
        let arena = ParseArena::new(1024);
        let debug_str = format!("{:?}", arena);
        assert!(debug_str.contains("ParseArena"));
    }
}
