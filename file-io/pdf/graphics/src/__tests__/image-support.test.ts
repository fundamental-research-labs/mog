import {
  computeImageHash,
  createTestJpeg,
  createTestPng,
  generateImagePlacementOps,
  ImageCache,
  parseImageDimensions,
} from '../image-support';

describe('Image Support', () => {
  // ── JPEG Dimension Parsing ──────────────────────────────────────

  describe('JPEG dimension parsing', () => {
    it('parses dimensions from a valid JPEG', () => {
      const jpeg = createTestJpeg(640, 480);
      const result = parseImageDimensions(jpeg, 'jpeg');
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.hasAlpha).toBe(false);
    });

    it('parses small dimensions', () => {
      const jpeg = createTestJpeg(1, 1);
      const result = parseImageDimensions(jpeg, 'jpeg');
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
    });

    it('parses large dimensions', () => {
      const jpeg = createTestJpeg(4096, 2160);
      const result = parseImageDimensions(jpeg, 'jpeg');
      expect(result.width).toBe(4096);
      expect(result.height).toBe(2160);
    });

    it('JPEG never has alpha', () => {
      const jpeg = createTestJpeg(100, 100);
      const result = parseImageDimensions(jpeg, 'jpeg');
      expect(result.hasAlpha).toBe(false);
    });

    it('throws for data too short', () => {
      expect(() => parseImageDimensions(new Uint8Array([0xff]), 'jpeg')).toThrow();
    });

    it('throws for invalid JPEG (missing SOI)', () => {
      expect(() => parseImageDimensions(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 'jpeg')).toThrow(
        'Not a valid JPEG',
      );
    });

    it('throws for JPEG with no SOF marker', () => {
      // Valid SOI but no SOF marker
      const data = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI + EOI only
      expect(() => parseImageDimensions(data, 'jpeg')).toThrow('no SOF marker');
    });
  });

  // ── PNG Dimension Parsing ───────────────────────────────────────

  describe('PNG dimension parsing', () => {
    it('parses dimensions from a valid PNG (truecolor)', () => {
      const png = createTestPng(800, 600, 2);
      const result = parseImageDimensions(png, 'png');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.hasAlpha).toBe(false);
    });

    it('detects alpha channel for color type 6 (truecolor + alpha)', () => {
      const png = createTestPng(256, 256, 6);
      const result = parseImageDimensions(png, 'png');
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      expect(result.hasAlpha).toBe(true);
    });

    it('detects alpha channel for color type 4 (grayscale + alpha)', () => {
      const png = createTestPng(100, 100, 4);
      const result = parseImageDimensions(png, 'png');
      expect(result.hasAlpha).toBe(true);
    });

    it('no alpha for color type 0 (grayscale)', () => {
      const png = createTestPng(100, 100, 0);
      const result = parseImageDimensions(png, 'png');
      expect(result.hasAlpha).toBe(false);
    });

    it('no alpha for color type 2 (truecolor)', () => {
      const png = createTestPng(100, 100, 2);
      const result = parseImageDimensions(png, 'png');
      expect(result.hasAlpha).toBe(false);
    });

    it('no alpha for color type 3 (indexed)', () => {
      const png = createTestPng(100, 100, 3);
      const result = parseImageDimensions(png, 'png');
      expect(result.hasAlpha).toBe(false);
    });

    it('parses large dimensions', () => {
      const png = createTestPng(8192, 4096, 2);
      const result = parseImageDimensions(png, 'png');
      expect(result.width).toBe(8192);
      expect(result.height).toBe(4096);
    });

    it('throws for data too short', () => {
      expect(() => parseImageDimensions(new Uint8Array([137, 80]), 'png')).toThrow('too short');
    });

    it('throws for invalid PNG signature', () => {
      const bad = new Uint8Array(24).fill(0);
      expect(() => parseImageDimensions(bad, 'png')).toThrow('Not a valid PNG');
    });
  });

  // ── Image Hashing ──────────────────────────────────────────────

  describe('computeImageHash', () => {
    it('returns consistent hash for same data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = computeImageHash(data);
      const hash2 = computeImageHash(data);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different data', () => {
      const hash1 = computeImageHash(new Uint8Array([1, 2, 3]));
      const hash2 = computeImageHash(new Uint8Array([4, 5, 6]));
      expect(hash1).not.toBe(hash2);
    });

    it('returns 8-character hex string', () => {
      const hash = computeImageHash(new Uint8Array([1, 2, 3]));
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles empty data', () => {
      const hash = computeImageHash(new Uint8Array([]));
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  // ── ImageCache ──────────────────────────────────────────────────

  describe('ImageCache', () => {
    it('registers and deduplicates images', () => {
      const cache = new ImageCache();
      const jpeg = createTestJpeg(100, 100);

      const entry1 = cache.register(jpeg, 'jpeg');
      const entry2 = cache.register(jpeg, 'jpeg');

      expect(entry1.name).toBe(entry2.name);
      expect(cache.size).toBe(1);
    });

    it('creates separate entries for different images', () => {
      const cache = new ImageCache();
      const jpeg1 = createTestJpeg(100, 100);
      const jpeg2 = createTestJpeg(200, 200);

      const entry1 = cache.register(jpeg1, 'jpeg');
      const entry2 = cache.register(jpeg2, 'jpeg');

      expect(entry1.name).not.toBe(entry2.name);
      expect(cache.size).toBe(2);
    });

    it('assigns sequential names', () => {
      const cache = new ImageCache();
      const entry1 = cache.register(createTestJpeg(100, 100), 'jpeg');
      const entry2 = cache.register(createTestJpeg(200, 200), 'jpeg');

      expect(entry1.name).toBe('Im0');
      expect(entry2.name).toBe('Im1');
    });

    it('stores parsed image info', () => {
      const cache = new ImageCache();
      const jpeg = createTestJpeg(640, 480);
      const entry = cache.register(jpeg, 'jpeg');

      expect(entry.info.width).toBe(640);
      expect(entry.info.height).toBe(480);
      expect(entry.info.format).toBe('jpeg');
      expect(entry.info.hasAlpha).toBe(false);
    });

    it('detects alpha for PNG', () => {
      const cache = new ImageCache();
      const png = createTestPng(256, 256, 6);
      const entry = cache.register(png, 'png');

      expect(entry.info.hasAlpha).toBe(true);
    });

    it('getAll returns all registered images', () => {
      const cache = new ImageCache();
      cache.register(createTestJpeg(100, 100), 'jpeg');
      cache.register(createTestJpeg(200, 200), 'jpeg');
      cache.register(createTestPng(300, 300), 'png');

      const all = cache.getAll();
      expect(all.length).toBe(3);
    });

    it('clear resets the cache', () => {
      const cache = new ImageCache();
      cache.register(createTestJpeg(100, 100), 'jpeg');
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);

      // New entries start from Im0
      const entry = cache.register(createTestJpeg(200, 200), 'jpeg');
      expect(entry.name).toBe('Im0');
    });
  });

  // ── generateImagePlacementOps ───────────────────────────────────

  describe('generateImagePlacementOps', () => {
    it('generates SaveState + ConcatMatrix + DrawImage + RestoreState', () => {
      const ops = generateImagePlacementOps('Im0', 10, 20, 100, 50);
      expect(ops.length).toBe(4);
      expect(ops[0]).toEqual({ op: 'SaveState' });
      expect(ops[1]).toEqual({
        op: 'ConcatMatrix',
        a: 100,
        b: 0,
        c: 0,
        d: 50,
        tx: 10,
        ty: 20,
      });
      expect(ops[2]).toEqual(expect.objectContaining({ op: 'DrawImage' }));
      expect(ops[3]).toEqual({ op: 'RestoreState' });
    });

    it('uses the provided resource name', () => {
      const ops = generateImagePlacementOps('Im42', 0, 0, 100, 100);
      const drawOp = ops.find((o) => o.op === 'DrawImage');
      expect(drawOp).toBeDefined();
      if (drawOp && drawOp.op === 'DrawImage') {
        expect(drawOp.format).toBe('Im42');
      }
    });
  });

  // ── Test Image Helpers ──────────────────────────────────────────

  describe('createTestJpeg', () => {
    it('creates parseable JPEG data', () => {
      const jpeg = createTestJpeg(320, 240);
      expect(jpeg[0]).toBe(0xff);
      expect(jpeg[1]).toBe(0xd8); // SOI

      const dims = parseImageDimensions(jpeg, 'jpeg');
      expect(dims.width).toBe(320);
      expect(dims.height).toBe(240);
    });
  });

  describe('createTestPng', () => {
    it('creates parseable PNG data', () => {
      const png = createTestPng(512, 512);
      expect(png[0]).toBe(137); // PNG signature byte 0

      const dims = parseImageDimensions(png, 'png');
      expect(dims.width).toBe(512);
      expect(dims.height).toBe(512);
    });

    it('creates PNG with alpha channel', () => {
      const png = createTestPng(100, 100, 6);
      const dims = parseImageDimensions(png, 'png');
      expect(dims.hasAlpha).toBe(true);
    });
  });
});
