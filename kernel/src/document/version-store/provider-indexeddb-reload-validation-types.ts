export type RowValidationContext = {
  readonly store: string;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly rowIndex?: number;
};

export type RefRowValidationContext = RowValidationContext & {
  readonly documentId: string;
};
