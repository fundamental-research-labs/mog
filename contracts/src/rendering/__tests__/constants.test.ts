import { DEFAULT_ROW_HEIGHT } from '../constants';

describe('rendering constants', () => {
  test('DEFAULT_ROW_HEIGHT matches OOXML spec (15pt at 96 DPI)', () => {
    // OOXML default row height is 15pt. At 96 DPI: 15 × 96/72 = 20px.
    // This must match the Rust compute engine's points_to_pixels(15.0) = 20.0.
    expect(DEFAULT_ROW_HEIGHT).toBe(20);
  });
});
