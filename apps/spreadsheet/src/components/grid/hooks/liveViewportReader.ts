import type {
  BinaryCellReader,
  BinaryViewportReader,
  ViewportReader,
} from '@mog-sdk/contracts/api';

export function createLiveViewportReader(getCurrent: () => ViewportReader): ViewportReader {
  const binary: BinaryViewportReader = {
    getCellData(row, col) {
      return getCurrent().binary.getCellData(row, col);
    },
    getBuffer() {
      return getCurrent().binary.getBuffer();
    },
    isReady() {
      return getCurrent().binary.isReady();
    },
  };

  return {
    getCellData(row, col) {
      return getCurrent().getCellData(row, col);
    },
    getActiveCellData() {
      return getCurrent().getActiveCellData();
    },
    getMerges() {
      return getCurrent().getMerges();
    },
    hasComment(row, col) {
      return getCurrent().hasComment(row, col);
    },
    getRowDimension(row) {
      return getCurrent().getRowDimension(row);
    },
    getColDimension(col) {
      return getCurrent().getColDimension(col);
    },
    getBounds() {
      return getCurrent().getBounds();
    },
    getRowPositions() {
      return getCurrent().getRowPositions();
    },
    getColPositions() {
      return getCurrent().getColPositions();
    },
    binary,
    get binaryCellReader(): BinaryCellReader | null {
      return getCurrent().binaryCellReader;
    },
    binaryCellReaderForViewport(viewportId) {
      return getCurrent().binaryCellReaderForViewport?.(viewportId);
    },
  };
}
