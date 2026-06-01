import { createTextMeasurementService } from '../text-measurement-service';
import type { CultureInfo } from '@mog-sdk/contracts/culture';

const culture = {} as CultureInfo;

function createContext() {
  return {
    font: '',
    measureText(text: string) {
      return { width: text.length * 7 };
    },
  };
}

describe('TextMeasurementService', () => {
  it('counts hard line breaks when measuring non-wrapped cell height', () => {
    const service = createTextMeasurementService(createContext());
    const single = service.measureCellHeight('Line 1', undefined, culture, 120);
    const triple = service.measureCellHeight('Line 1\nLine 2\nLine 3', undefined, culture, 120);

    expect(triple).toBeGreaterThan(single + 20);
  });
});
