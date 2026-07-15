import type {
  SlicerDuplicateReceipt,
  SlicerRemoveReceipt,
  SlicerSelectionClearReceipt,
  SlicerSelectionSetReceipt,
  SlicerUpdateReceipt,
} from './mutation-receipt';
import type { Slicer } from './types';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _UpdateCarriesState = Assert<IsEqual<SlicerUpdateReceipt['slicer'], Slicer>>;
type _RemoveCarriesState = Assert<IsEqual<SlicerRemoveReceipt['slicer'], Slicer>>;
type _DuplicateCarriesState = Assert<IsEqual<SlicerDuplicateReceipt['slicer'], Slicer>>;
type _SelectionSetCarriesState = Assert<IsEqual<SlicerSelectionSetReceipt['slicer'], Slicer>>;
type _SelectionClearCarriesState = Assert<IsEqual<SlicerSelectionClearReceipt['slicer'], Slicer>>;
