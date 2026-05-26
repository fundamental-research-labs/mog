export type DeploymentProfile = 'local-dev' | 'single-node' | 'horizontal' | 'air-gapped';

export type SecretRef =
  | { source: 'env'; name: string }
  | { source: 'file'; path: string }
  | { source: 'vault'; provider: 'hashicorp' | 'aws-sm' | 'gcp-sm'; key: string };

// ---------------------------------------------------------------------------
// Service endpoints
// ---------------------------------------------------------------------------

export interface TlsConfig {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  minVersion?: '1.2' | '1.3';
  clientAuth?: 'none' | 'optional' | 'required';
  clientCaPath?: string;
}

export interface ServiceEndpoint {
  listenAddress: string;
  publicOrigin?: string;
  allowedOrigins?: string[];
  colocated?: boolean;
  tls?: TlsConfig;
  behindProxy?: boolean;
  healthPath?: string;
}

export interface ServiceConfig {
  controlPlane: ServiceEndpoint;
  document: ServiceEndpoint;
  collaboration: ServiceEndpoint;
  compute: ServiceEndpoint;
  file: ServiceEndpoint;
  admin: ServiceEndpoint;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthAdapterType = 'oidc' | 'saml' | 'local-dev' | 'single-user';

export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: SecretRef;
  clientSecret: SecretRef;
  scopes?: string[];
  userIdClaim?: string;
  displayNameClaim?: string;
  emailClaim?: string;
  audiences?: string[];
}

export interface SamlProviderConfig {
  idpMetadataUrl?: string;
  idpMetadataPath?: string;
  entityId: string;
  acsUrl: string;
  spCert?: SecretRef;
  spKey?: SecretRef;
}

export interface SingleUserConfig {
  displayName?: string;
  passphrase?: SecretRef;
}

export interface SessionConfig {
  ttlSeconds?: number;
  slidingWindow?: boolean;
  cookieName?: string;
  cookieSecure?: boolean;
  cookieSameSite?: 'strict' | 'lax' | 'none';
  signingKey?: SecretRef;
}

export interface ApiKeyConfig {
  enabled: boolean;
  prefix?: string;
  maxKeysPerUser?: number;
  hashAlgorithm?: 'sha256' | 'argon2';
}

export interface ServiceAccountConfig {
  enabled: boolean;
  sharedSecret?: SecretRef;
  mtls?: {
    enabled: boolean;
    caPath: string;
    certPath: string;
    keyPath: string;
  };
}

export interface AuthConfig {
  adapter: AuthAdapterType;
  oidc?: OidcProviderConfig;
  saml?: SamlProviderConfig;
  singleUser?: SingleUserConfig;
  session: SessionConfig;
  apiKeys?: ApiKeyConfig;
  serviceAccounts?: ServiceAccountConfig;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type ObjectStoreConfig =
  | ObjectStoreS3Config
  | ObjectStoreGcsConfig
  | ObjectStoreLocalConfig
  | ObjectStoreMinioConfig;

export interface ObjectStoreS3Config {
  provider: 's3';
  bucket: string;
  prefix?: string;
  region: string;
  endpoint?: string;
  accessKeyId?: SecretRef;
  secretAccessKey?: SecretRef;
  forcePathStyle?: boolean;
  sse?: 'AES256' | 'aws:kms';
  kmsKeyArn?: string;
}

export interface ObjectStoreGcsConfig {
  provider: 'gcs';
  bucket: string;
  prefix?: string;
  credentialsPath?: string;
}

export interface ObjectStoreLocalConfig {
  provider: 'local';
  directory: string;
}

export interface ObjectStoreMinioConfig {
  provider: 'minio';
  endpoint: string;
  bucket: string;
  prefix?: string;
  accessKey: SecretRef;
  secretKey: SecretRef;
  useTls?: boolean;
}

export type MetadataDbConfig = MetadataDbPostgresConfig | MetadataDbSqliteConfig;

export interface MetadataDbPostgresConfig {
  provider: 'postgres';
  connectionUrl: SecretRef;
  poolSize?: number;
  sslMode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  sslCaPath?: string;
  autoMigrate?: boolean;
}

export interface MetadataDbSqliteConfig {
  provider: 'sqlite';
  path: string;
  walMode?: boolean;
  journalSizeLimit?: number;
}

export interface UpdateLogConfig {
  provider: 'database' | 'object-store';
  compactionThreshold?: number;
  maxUpdateAge?: number;
}

export interface BackupConfig {
  enabled: boolean;
  schedule?: string;
  destination?: string;
  retainCount?: number;
}

export interface RetentionConfig {
  softDeleteTtl?: number;
  hardDeleteTtl?: number;
}

export interface CompactionConfig {
  enabled: boolean;
  schedule?: string;
  updateCountThreshold?: number;
}

export interface StorageLifecycleConfig {
  backup?: BackupConfig;
  retention?: RetentionConfig;
  compaction?: CompactionConfig;
}

export interface StorageEncryptionConfig {
  keyRef: SecretRef;
  algorithm?: 'aes-256-gcm' | 'chacha20-poly1305';
  rotationInterval?: number;
  previousKeys?: SecretRef[];
}

export interface StorageConfig {
  objectStore: ObjectStoreConfig;
  metadataDb: MetadataDbConfig;
  updateLog: UpdateLogConfig;
  lifecycle: StorageLifecycleConfig;
  encryption?: StorageEncryptionConfig;
}

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

export type RoomPolicy = 'open' | 'document-acl' | 'invite-only';
export type CollabPersistenceAdapter = 'database' | 'object-store' | 'memory';
export type CollabScalingMode = 'single-node' | 'horizontal';

export type CollabBrokerConfig = CollabBrokerRedisConfig | CollabBrokerNatsConfig;

export interface CollabBrokerRedisConfig {
  provider: 'redis';
  url: SecretRef;
  prefix?: string;
  cluster?: boolean;
}

export interface CollabBrokerNatsConfig {
  provider: 'nats';
  servers: string[];
  prefix?: string;
  credentials?: SecretRef;
}

export interface CollaborationConfig {
  roomPolicy: RoomPolicy;
  maxParticipantsPerRoom?: number;
  maxMessageSize?: number;
  persistence: CollabPersistenceAdapter;
  scalingMode: CollabScalingMode;
  broker?: CollabBrokerConfig;
  idleRoomTimeout?: number;
  heartbeatInterval?: number;
  wsPort?: number;
  allowedOrigins?: string[];
}

// ---------------------------------------------------------------------------
// Runtime assets
// ---------------------------------------------------------------------------

export interface AssetLocation {
  path?: string;
  url?: string;
}

export interface WasmVariant {
  simd?: boolean;
  threading?: boolean;
  initialMemoryPages?: number;
  maxMemoryPages?: number;
}

export interface RuntimeAssetConfig {
  wasm: AssetLocation;
  workerJs?: AssetLocation;
  fonts?: AssetLocation;
  baseUrl?: string;
  wasmVariant?: WasmVariant;
  integrity?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface HttpLimitsConfig {
  maxSessions?: number;
  maxUploadBytes?: number;
  maxDownloadBytes?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  maxConcurrentRequestsPerSession?: number;
}

export interface ExecuteCodePolicy {
  enabled: boolean;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  allowedGlobals?: string[];
  blockNetwork?: boolean;
  blockFilesystem?: boolean;
  allowTempDirRead?: boolean;
  maxSandboxFileSize?: number;
}

export interface AgentPolicy {
  enabled: boolean;
  agentUrl?: string;
  maxConcurrentQueries?: number;
  queryTimeoutMs?: number;
  bypassToken?: SecretRef;
}

export interface RateLimitsConfig {
  requestsPerMinutePerIp?: number;
  requestsPerMinutePerSession?: number;
  executionsPerMinutePerSession?: number;
  wsMessagesPerSecondPerConnection?: number;
}

export interface QuotasConfig {
  maxDocumentsPerUser?: number;
  maxStorageBytesPerUser?: number;
  maxWorkbookSize?: number;
  maxSheetsPerWorkbook?: number;
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
}

export interface LimitsConfig {
  http: HttpLimitsConfig;
  executeCode: ExecuteCodePolicy;
  agent?: AgentPolicy;
  rateLimits?: RateLimitsConfig;
  quotas?: QuotasConfig;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type MetricsSinkConfig =
  | { provider: 'prometheus'; listenAddress?: string; path?: string }
  | { provider: 'otlp'; endpoint: string; headers?: Record<string, string> }
  | { provider: 'none' };

export type LogSinkConfig =
  | { provider: 'stdout'; format?: 'json' | 'text'; level?: LogLevel }
  | {
      provider: 'file';
      path: string;
      format?: 'json' | 'text';
      level?: LogLevel;
      maxSizeBytes?: number;
      rotateCount?: number;
    }
  | { provider: 'otlp'; endpoint: string; level?: LogLevel }
  | { provider: 'none' };

export type TraceSinkConfig =
  | { provider: 'otlp'; endpoint: string; samplingRate?: number }
  | { provider: 'jaeger'; endpoint: string; samplingRate?: number }
  | { provider: 'none' };

export type AuditSinkConfig =
  | { provider: 'database' }
  | { provider: 'file'; path: string }
  | { provider: 'otlp'; endpoint: string }
  | { provider: 'none' };

export type DiagnosticsRedactionLevel = 'none' | 'standard' | 'strict';

export interface ObservabilityConfig {
  metrics?: MetricsSinkConfig;
  logs?: LogSinkConfig;
  traces?: TraceSinkConfig;
  audit?: AuditSinkConfig;
  redaction?: DiagnosticsRedactionLevel;
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export interface RedactionPolicy {
  cellValues: boolean;
  formulas: boolean;
  emails: boolean;
  ipAddresses: boolean;
  documentNames: boolean;
}

export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods?: string[];
  allowedHeaders?: string[];
  maxAge?: number;
  allowCredentials?: boolean;
}

export interface HstsConfig {
  enabled: boolean;
  maxAge?: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

export interface SecurityConfig {
  rawBytePolicy: 'block' | 'warn' | 'allow';
  exportPolicy: 'authenticated' | 'owner-only' | 'disabled';
  tenantIsolation: 'single-tenant' | 'multi-tenant';
  redactionPolicy: RedactionPolicy;
  csp?: string;
  cors?: CorsConfig;
  hsts?: HstsConfig;
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export interface MogSelfHostConfig {
  version: '0.1';
  profile: DeploymentProfile;
  services: ServiceConfig;
  auth: AuthConfig;
  storage: StorageConfig;
  collaboration: CollaborationConfig;
  assets: RuntimeAssetConfig;
  limits: LimitsConfig;
  observability: ObservabilityConfig;
  security: SecurityConfig;
}
