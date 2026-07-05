import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';

import { mogWasmPlugin } from '@mog/vite-wasm-plugin';

const DEV_AGENT_CHAT_COMPLETIONS_ROUTE = '/api/mog-dev-agent/chat/completions';

interface DevAgentProxyEnv {
  readonly MOG_DEV_AGENT_API_KEY?: string;
  readonly MOG_DEV_AGENT_BASE_URL?: string;
  readonly PIVOT_API_KEY?: string;
  readonly PIVOT_BASE_URL?: string;
  readonly SHORTCUT_API_KEY?: string;
  readonly SHORTCUT_PIVOT_API_BASE_URL?: string;
  readonly SHORTCUT_PIVOT_API_KEY?: string;
  readonly SHORTCUT_PIVOT_API_URL?: string;
  readonly SHORTCUT_PIVOT_BASE_URL?: string;
  readonly SHORTCUT_TOKEN?: string;
}

type EnvSource = Record<string, string | undefined>;

/**
 * Dev-only fingerprint injection.
 *
 * Injects `<meta name="app-eval-fingerprint" content="mog-spreadsheet-dev">` into
 * index.html during `vite serve`. app-eval's `preflightUrl` fetches the URL the
 * caller passed via `--url` and looks for this tag to confirm the target is our
 * dev app (and not a random Vite/React project that happens to answer on that
 * port). The `apply: 'serve'` gate is load-bearing: the tag MUST NOT ship to a
 * production bundle. Production builds are checked by ensuring the tag is
 * absent from `dist/index.html`.
 */
function injectFingerprint(): Plugin {
  return {
    name: 'inject-app-eval-fingerprint',
    apply: 'serve', // critical: dev only, never in production bundles
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return html.replace(
          /<head>/,
          '<head>\n    <meta name="app-eval-fingerprint" content="mog-spreadsheet-dev">',
        );
      },
    },
  };
}

function normalizeChatCompletionsBaseUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) {
    normalized = normalized.slice(0, -'/chat/completions'.length);
  }
  if (!normalized.endsWith('/v1')) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}

function readEnvValue(source: EnvSource, key: keyof DevAgentProxyEnv): string | undefined {
  const value = source[key];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pickDevAgentProxyEnv(source: EnvSource): DevAgentProxyEnv {
  return {
    MOG_DEV_AGENT_API_KEY: readEnvValue(source, 'MOG_DEV_AGENT_API_KEY'),
    MOG_DEV_AGENT_BASE_URL: readEnvValue(source, 'MOG_DEV_AGENT_BASE_URL'),
    PIVOT_API_KEY: readEnvValue(source, 'PIVOT_API_KEY'),
    PIVOT_BASE_URL: readEnvValue(source, 'PIVOT_BASE_URL'),
    SHORTCUT_API_KEY: readEnvValue(source, 'SHORTCUT_API_KEY'),
    SHORTCUT_PIVOT_API_BASE_URL: readEnvValue(source, 'SHORTCUT_PIVOT_API_BASE_URL'),
    SHORTCUT_PIVOT_API_KEY: readEnvValue(source, 'SHORTCUT_PIVOT_API_KEY'),
    SHORTCUT_PIVOT_API_URL: readEnvValue(source, 'SHORTCUT_PIVOT_API_URL'),
    SHORTCUT_PIVOT_BASE_URL: readEnvValue(source, 'SHORTCUT_PIVOT_BASE_URL'),
    SHORTCUT_TOKEN: readEnvValue(source, 'SHORTCUT_TOKEN'),
  };
}

function mergeDevAgentProxyEnv(...sources: readonly DevAgentProxyEnv[]): DevAgentProxyEnv {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const trimmed = value?.trim();
      if (trimmed) merged[key] = trimmed;
    }
  }
  return merged as unknown as DevAgentProxyEnv;
}

function resolvePivotApiKey(env: DevAgentProxyEnv): string | undefined {
  return (
    env.MOG_DEV_AGENT_API_KEY ??
    env.PIVOT_API_KEY ??
    env.SHORTCUT_PIVOT_API_KEY ??
    env.SHORTCUT_API_KEY ??
    env.SHORTCUT_TOKEN
  );
}

function resolvePivotBaseUrl(env: DevAgentProxyEnv): string | undefined {
  const configured =
    env.MOG_DEV_AGENT_BASE_URL ??
    env.PIVOT_BASE_URL ??
    env.SHORTCUT_PIVOT_BASE_URL ??
    env.SHORTCUT_PIVOT_API_BASE_URL ??
    env.SHORTCUT_PIVOT_API_URL;
  return configured ? normalizeChatCompletionsBaseUrl(configured) : undefined;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function shouldForwardUpstreamHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower !== 'connection' &&
    lower !== 'content-encoding' &&
    lower !== 'content-length' &&
    lower !== 'transfer-encoding'
  );
}

function devAgentProxy(initialEnv: DevAgentProxyEnv): Plugin {
  return {
    name: 'mog-dev-agent-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(DEV_AGENT_CHAT_COMPLETIONS_ROUTE, async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: 'Method not allowed.' } }));
          return;
        }

        const env = mergeDevAgentProxyEnv(initialEnv, pickDevAgentProxyEnv(process.env));
        const apiKey = resolvePivotApiKey(env);
        const baseUrl = resolvePivotBaseUrl(env);
        if (!apiKey || !baseUrl) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                message:
                  'Pivot provider is not configured. Set MOG_DEV_AGENT_API_KEY/PIVOT_API_KEY/SHORTCUT_PIVOT_API_KEY and MOG_DEV_AGENT_BASE_URL/PIVOT_BASE_URL/SHORTCUT_PIVOT_BASE_URL.',
              },
            }),
          );
          return;
        }

        try {
          const body = (await readRequestBody(req)).toString('utf8');
          const upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: body || undefined,
          });

          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (!shouldForwardUpstreamHeader(key)) return;
            res.setHeader(key, value);
          });

          if (!upstream.body) {
            res.end();
            return;
          }

          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          );
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const publicRoot = path.resolve(__dirname, '..', '..');
  const packageEnv = loadEnv(mode, __dirname, '');
  const workspaceEnv = loadEnv(mode, publicRoot, '');
  const serverEnv = {
    ...workspaceEnv,
    ...packageEnv,
    ...process.env,
  };
  const pivotEnv = mergeDevAgentProxyEnv(pickDevAgentProxyEnv(serverEnv));
  const env = serverEnv;
  const enableHmr = env.MOG_DEV_HMR === '1' || env.MOG_DEV_HMR === 'true';

  // Resolver condition selection: honor the `development` export
  // condition so composite workspace packages resolve to `src/*.ts` during
  // `vite dev` (HMR path). Under `vite build` we drop the `conditions`
  // override entirely — Vite's defaults then resolve to `dist/` via the
  // `import` condition. The `command === 'serve'` gate is required: a
  // naive single-list setup leaks `development` into production bundles.
  //
  // VITE_FLEET_BUILD: fleet Docker images pre-build the SPA for static
  // serving (vite dev is too slow in Docker — unbundled ESM causes 30s+
  // SPA boot). When set, resolve to `src/*.ts` in build mode too, since
  // workspace packages don't have dist/ in the Docker image.
  const resolveConditions =
    command === 'serve' || env.VITE_FLEET_BUILD
      ? ['development', 'import', 'module', 'browser', 'default']
      : undefined;

  return {
    plugins: [
      ...mogWasmPlugin(),
      injectFingerprint(),
      devAgentProxy(pivotEnv),
      react(),
      svgr({
        // Transform SVGs to React components when imported with ?react
        include: '**/*.svg?react',
        svgrOptions: {
          // Ensure SVGs use currentColor and are sized properly
          svgProps: {
            role: 'img',
          },
        },
      }),
    ],
    resolve: {
      conditions: resolveConditions,
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      alias: {
        // Deduplicate React to prevent multiple copies in monorepo
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        '@mog-sdk/kernel/app-api': path.resolve(publicRoot, 'kernel/src/api/app/index.ts'),
        // Private friend exports are intentionally stripped from public
        // artifacts and cannot carry a development condition. The dev app
        // still needs the host-backed lifecycle to run against source so
        // app-eval exercises the same kernel code under edit.
        '@mog-sdk/kernel/host-lifecycle-internal': path.resolve(
          publicRoot,
          'kernel/src/host-lifecycle-internal.ts',
        ),
        '@mog/app-spreadsheet/globals.css': path.resolve(
          publicRoot,
          'apps/spreadsheet/src/infra/styles/globals.css',
        ),
      },
    },
    server: {
      port: 3002,
      open: false, // Disabled to allow opening DevTools before page load
      fs: {
        allow: [path.resolve(__dirname, '..', '..'), publicRoot],
      },
      ...(enableHmr ? { hmr: true } : { hmr: false, watch: null }),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          devtools: path.resolve(__dirname, 'devtools.html'),
        },
      },
    },
    optimizeDeps: {
      // Don't pre-bundle - let Vite resolve from workspace packages
      exclude: [],
    },
  };
});
