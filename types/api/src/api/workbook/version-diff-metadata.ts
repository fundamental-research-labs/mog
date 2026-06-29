export interface VersionDiffCellCoordinate {
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
}

export interface VersionDiffRangeCoordinate {
  readonly sheetId: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

export interface VersionDiffHistoricalMetadata {
  readonly cell?: VersionDiffCellCoordinate;
  readonly range?: VersionDiffRangeCoordinate;
}
