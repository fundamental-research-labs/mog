export type VersionGraphStoreOperation =
  | 'initializeGraph'
  | 'commit'
  | 'mergeCommit'
  | 'fastForwardRef'
  | 'createBranch'
  | 'readBranch'
  | 'listBranches'
  | 'fastForwardBranch'
  | 'getHead'
  | 'readCommitClosure'
  | 'readHead'
  | 'readRef'
  | 'listCommits';
