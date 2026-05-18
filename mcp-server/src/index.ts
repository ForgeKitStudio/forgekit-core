#!/usr/bin/env node
/**
 * @forgekitstudio/core-mcp — entrypoint.
 *
 * Parses CLI flags, performs the startup license scan, and hands control to
 * `bootstrapServer()` which selects one of three runtime modes:
 *
 *   --smoke         Print the legacy skeleton acknowledgement to stderr and
 *                   resolve immediately. Preserved for QA smoke tooling that
 *                   only checked for the skeleton line.
 *
 *   --stdio         Start an MCP `Server` over `StdioServerTransport`,
 *                   register `tools/list` + `tools/call` handlers wired to the
 *                   in-process `ChannelRouter` (CLI executor only — editor
 *                   and runtime channels report `channel-unavailable` until
 *                   the transports are wired in their own bootstrap step).
 *
 *   default         Headless mode. Boots the health endpoint and blocks on
 *                   SIGTERM/SIGINT so future bootstrap steps can plug into
 *                   the same lifecycle.
 *
 * Stdout is reserved for JSON-RPC traffic in stdio mode, so every diagnostic
 * line goes to stderr.
 */

import type { Readable, Writable } from 'node:stream';

/** MCP tool profile names recognised by the server. */
export type Profile = 'Full' | 'Lite' | 'Minimal' | 'RPG-only';

/** Log verbosity recognised by `--mcp-log-level`. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Parsed command-line options. */
export interface CliOptions {
  stdio: boolean;
  profile: Profile;
  logLevel: LogLevel;
  licenseDir: string | undefined;
  smoke: boolean;
}

const ALLOWED_PROFILES: readonly Profile[] = ['Full', 'Lite', 'Minimal', 'RPG-only'];
const ALLOWED_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const DEFAULT_OPTIONS: CliOptions = {
  stdio: false,
  profile: 'Full',
  logLevel: 'info',
  licenseDir: undefined,
  smoke: false,
};

/**
 * Parse the arguments slice passed after the node binary and script path
 * (i.e. `process.argv.slice(2)`).
 *
 * Supported flags:
 *   --stdio                        boolean, default false
 *   --smoke                        boolean, default false
 *   --profile <Full|Lite|Minimal|RPG-only>
 *                                  default Full
 *   --mcp-log-level <debug|info|warn|error>
 *                                  default info
 *   --license-dir <path>           optional explicit license directory
 *
 * Throws an `Error` whose message lists the allowed values when a flag
 * receives a value outside of its allowed set, or when a value-taking flag
 * is missing its argument.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_OPTIONS };

  // Support both `--flag value` and `--flag=value` forms by splitting on the
  // first `=` for any flag that carries a value.
  const splitEq = (arg: string): { flag: string; inline: string | null } => {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      return { flag: arg, inline: null };
    }
    return { flag: arg.slice(0, eq), inline: arg.slice(eq + 1) };
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--stdio') {
      options.stdio = true;
      continue;
    }
    if (raw === '--smoke') {
      options.smoke = true;
      continue;
    }

    const { flag, inline } = splitEq(raw);

    if (flag === '--profile') {
      let value: string | undefined;
      if (inline !== null) {
        value = inline;
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined || value === '') {
        throw new Error(
          `--profile requires a value. Allowed: ${ALLOWED_PROFILES.join(', ')}.`,
        );
      }
      if (!isProfile(value)) {
        throw new Error(
          `Invalid --profile value "${value}". Allowed: ${ALLOWED_PROFILES.join(', ')}.`,
        );
      }
      options.profile = value;
      continue;
    }

    if (flag === '--mcp-log-level') {
      let value: string | undefined;
      if (inline !== null) {
        value = inline;
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined || value === '') {
        throw new Error(
          `--mcp-log-level requires a value. Allowed: ${ALLOWED_LOG_LEVELS.join(', ')}.`,
        );
      }
      if (!isLogLevel(value)) {
        throw new Error(
          `Invalid --mcp-log-level value "${value}". Allowed: ${ALLOWED_LOG_LEVELS.join(', ')}.`,
        );
      }
      options.logLevel = value;
      continue;
    }

    if (flag === '--license-dir') {
      let value: string | undefined;
      if (inline !== null) {
        value = inline;
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined || value === '') {
        throw new Error('--license-dir requires a path value.');
      }
      options.licenseDir = value;
      continue;
    }

    throw new Error(`Unknown argument: "${raw}".`);
  }

  return options;
}

function isProfile(value: string): value is Profile {
  return (ALLOWED_PROFILES as readonly string[]).includes(value);
}

function isLogLevel(value: string): value is LogLevel {
  return (ALLOWED_LOG_LEVELS as readonly string[]).includes(value);
}

/** Dependency-injection surface for subcommand handlers. */
export interface MainHandlers {
  /**
   * Handler for the `install-hooks` subcommand. Receives the remaining argv
   * (with the subcommand stripped) and returns a process exit code.
   */
  installHooksHandler?: (argv: readonly string[]) => Promise<number>;
}

/**
 * Driver: route subcommands, parse flags and hand over to `bootstrapServer`.
 *
 * Positional subcommands take precedence over flag parsing:
 *   - `install-hooks` — route to the installer that writes the
 *     `commit-msg` / `pre-commit` shims into `.git/hooks/`.
 *
 * Returns a process exit code; the caller owns `process.exit`.
 */
export async function main(
  argv: readonly string[],
  handlers: MainHandlers = {},
): Promise<number> {
  if (argv[0] === 'install-hooks') {
    const handler =
      handlers.installHooksHandler ??
      (async (rest: readonly string[]): Promise<number> => {
        const mod = await import('./cli/install_hooks.js');
        return mod.runInstallHooks(rest);
      });
    return handler(argv.slice(1));
  }

  const options = parseCliArgs(argv);
  await bootstrapServer(options);
  return 0;
}

async function discoverUnlockedModulesDefault(
  options: CliOptions,
  stderr: Writable,
): Promise<ReadonlySet<string>> {
  const [{ resolveLicenseDir, loadActiveLicenses, unlockedModulesFromLicenses }] =
    await Promise.all([import('./licensing/startup.js')]);
  try {
    const dir = await resolveLicenseDir({
      projectRoot: process.cwd(),
      licenseDir: options.licenseDir,
    });
    const records = await loadActiveLicenses(dir, {
      logger: { warn: (msg: string) => stderr.write(`${msg}\n`) },
    });
    return unlockedModulesFromLicenses(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`[license] discovery failed: ${message}\n`);
    return new Set<string>();
  }
}

/** A health endpoint stub matching what `bootstrapServer` consumes. */
export interface HealthEndpointHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}

/** A subset of `ToolSchema` from `src/schema/define_schema.ts`. */
export interface BootstrapToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly [key: string]: unknown;
  };
  readonly outputSchema?: {
    readonly type: 'object';
    readonly [key: string]: unknown;
  };
}

/** A subset of `ProfilesFile` from `src/profiles.ts`. */
export interface BootstrapProfilesFile {
  readonly version: string;
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly scope: 'core' | 'module';
    readonly channel: 'editor' | 'runtime' | 'cli' | 'cross';
    readonly module: string;
  }>;
}

export interface BootstrapServerDeps {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
  readonly shutdownSignal?: AbortSignal;
  readonly discoverUnlockedModules?: (
    options: CliOptions,
  ) => Promise<ReadonlySet<string>>;
  readonly loadProfiles?: () => Promise<BootstrapProfilesFile>;
  readonly toolSchemas?: ReadonlyMap<string, BootstrapToolSchema>;
  readonly healthEndpointFactory?: () => HealthEndpointHandle;
}

const SKELETON_LINE_PREFIX = '[@forgekitstudio/core-mcp] skeleton — ';

/**
 * Boots the server in one of three modes (smoke / stdio / headless) based on
 * the parsed `CliOptions`. Each branch is independently testable via the
 * `BootstrapServerDeps` injection surface.
 */
export async function bootstrapServer(
  options: CliOptions,
  deps: BootstrapServerDeps = {},
): Promise<void> {
  const stderr = deps.stderr ?? process.stderr;
  const discover =
    deps.discoverUnlockedModules ??
    ((opts: CliOptions): Promise<ReadonlySet<string>> =>
      discoverUnlockedModulesDefault(opts, stderr));

  const unlocked = await discover(options);
  stderr.write(
    `[license] unlocked modules: [${[...unlocked].sort().join(', ')}]\n`,
  );

  if (options.smoke) {
    stderr.write(
      `${SKELETON_LINE_PREFIX}stdio=${options.stdio}, profile=${options.profile}, ` +
      `logLevel=${options.logLevel}. Transport bridges are not wired up yet.\n`,
    );
    return;
  }

  if (options.stdio) {
    await runStdioMode(options, deps, stderr, unlocked);
    return;
  }

  await runHeadlessMode(options, deps, stderr);
}

async function runStdioMode(
  options: CliOptions,
  deps: BootstrapServerDeps,
  stderr: Writable,
  unlocked: ReadonlySet<string>,
): Promise<void> {
  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;

  const [
    { Server },
    { StdioServerTransport },
    { registerToolHandlers },
    profilesModule,
    schemaModule,
    cliExecutorModule,
    channelRouterModule,
  ] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('./server/tool_request_handlers.js'),
    import('./profiles.js'),
    import('./schema/tool_schemas.js'),
    import('./dispatcher/cli_executor.js'),
    import('./dispatcher/channel_router.js'),
  ]);

  const profiles =
    deps.loadProfiles !== undefined
      ? await deps.loadProfiles()
      : await loadDefaultProfiles(profilesModule);
  const schemas =
    deps.toolSchemas !== undefined
      ? deps.toolSchemas
      : (schemaModule.getToolSchemas() as ReadonlyMap<string, BootstrapToolSchema>);

  const cliExecutor = new cliExecutorModule.CliExecutor(profiles as never);
  const router = new channelRouterModule.ChannelRouter({
    profiles: profiles as never,
    editorClient: makeUnavailableClient('editor'),
    runtimeClient: makeUnavailableClient('runtime'),
    cliExecutor,
    crossExecutor: makeUnavailableCrossExecutor(),
  });

  const server = new Server(
    {
      name: '@forgekitstudio/core-mcp',
      version: SERVER_VERSION,
    },
    {
      capabilities: { tools: { listChanged: false } },
    },
  );

  registerToolHandlers(server, {
    profiles: profiles as never,
    profile: options.profile,
    unlockedModules: unlocked as ReadonlySet<never>,
    schemas: schemas as never,
    dispatcher: router,
  });

  const transport = new StdioServerTransport(
    stdin as Readable,
    stdout as Writable,
  );

  await server.connect(transport);

  stderr.write(
    `[mcp] stdio bridge ready (profile=${options.profile}, tools=${schemas.size})\n`,
  );

  await waitUntilShutdown(deps.shutdownSignal);

  try {
    await server.close();
  } catch {
    // Ignore: the SDK already closed the transport.
  }
}

async function runHeadlessMode(
  options: CliOptions,
  deps: BootstrapServerDeps,
  stderr: Writable,
): Promise<void> {
  const factory = deps.healthEndpointFactory;
  if (factory === undefined) {
    // Without a health endpoint the headless mode is a placeholder
    // that simply blocks on the shutdown signal so future bootstrap
    // steps (8.10) can plug their own services in.
    await waitUntilShutdown(deps.shutdownSignal);
    return;
  }

  const endpoint = factory();
  await endpoint.start();
  stderr.write(
    `[health] health endpoint listening on http://127.0.0.1:${endpoint.getPort()}\n`,
  );
  void options;
  try {
    await waitUntilShutdown(deps.shutdownSignal);
  } finally {
    try {
      await endpoint.stop();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      stderr.write(`[health] failed to stop health endpoint: ${detail}\n`);
    }
  }
}

async function loadDefaultProfiles(
  profilesModule: typeof import('./profiles.js'),
): Promise<BootstrapProfilesFile> {
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // The published layout puts `profiles.json` at the package root,
  // i.e. one level above `dist/src/`. Source-mode runs (e.g. `tsx`)
  // resolve through `src/` so the relative pattern still lands on the
  // package root.
  const candidates = [
    path.resolve(here, '..', '..', 'profiles.json'),
    path.resolve(here, '..', 'profiles.json'),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await profilesModule.loadProfiles(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to load profiles.json from any of [${candidates.join(', ')}]: ${detail}`,
  );
}

function makeUnavailableClient(channel: 'editor' | 'runtime') {
  return {
    async send(_method: string, _params: unknown): Promise<unknown> {
      throw new Error(`${channel}_channel_unavailable`);
    },
    isConnected(): boolean {
      return false;
    },
  };
}

function makeUnavailableCrossExecutor() {
  return {
    async invoke(_method: string, _params: unknown): Promise<unknown> {
      throw new Error('cross_channel_unavailable');
    },
  };
}

async function waitUntilShutdown(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise<void>((resolve) => {
      const onSignal = (): void => resolve();
      process.once('SIGTERM', onSignal);
      process.once('SIGINT', onSignal);
    });
  }
  if (signal.aborted) {
    return;
  }
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

const SERVER_VERSION = '0.10.0';

// Run `main()` only when this module is executed directly, so tests can import
// `parseCliArgs` without triggering side effects.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[@forgekitstudio/core-mcp] error: ${message}\n`);
      process.exit(1);
    });
}
