import type { ChannelSpec, EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { DataLabelConfig } from '../../../types';

/**
 * Build a data label text layer for overlay.
 * Maps DataLabelConfig.position and format to the text mark encoding.
 */
export function buildDataLabelLayer(
  dataLabels: DataLabelConfig,
  encoding: EncodingSpec,
): UnitSpec | undefined {
  if (!dataLabels.show) return undefined;

  const textChannel: ChannelSpec = { field: 'value', type: 'quantitative' };

  // Map format string to the text channel format
  if (dataLabels.format) {
    textChannel.format = dataLabels.format;
  }

  // Map position to mark-level dy/align properties
  const mark: MarkSpec = { type: 'text' };
  if (dataLabels.position) {
    switch (dataLabels.position) {
      case 'top':
      case 'outside':
        mark.baseline = -10; // offset above
        break;
      case 'bottom':
        mark.baseline = 10; // offset below
        break;
      case 'inside':
        // center inside, no offset needed
        break;
      // 'left' and 'right' are less common for data labels; default placement
    }
  }

  return {
    mark,
    encoding: {
      ...encoding,
      text: textChannel,
    },
  };
}
