#!/usr/bin/env node
/**
 * @forgekit/core-mcp — skeleton entrypoint.
 *
 * This module exposes a pure CLI argument parser plus a thin `main()` driver.
 * It intentionally does NOT spin up the WebSocket client, UDP client or stdio
 * JSON-RPC bridge. Those transports are wired in later once the Godot editor
 * plugin and runtime bridge are in place.
 *
 * Current scope:
 *   - parse `--stdio`, `--profile` and `--mcp-log-level` flags
 *   - validate flag values against their allowed sets
 *   - route the `install-hooks` positional subcommand
 *   - print a human-readable stub line to stderr and exit cleanly
 *
 * Stdout is reserved for future JSON-RPC traffic in stdio mode, so every log
 * line goes to stderr.
 */

/** MCP tool profile names recognised by the server.*/
export type Profile = 'Full' | 'Lite' | 'Minimal' | 'RPG-only';

/** Log verbosity recognised by `--mcp-log-level`. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Parsed command-line options. */
export interface CliOptions {
  stdio: boolean;
  profile: Profile;
  logLevel: LogLevel;
  licenseDir: string | undefined;
}

const ALLOWED_PROFILES: readonly Profile[] = ['Full', 'Lite', 'Minimal', 'RPG-only'];
const ALLOWED_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const DEFAULT_OPTIONS: CliOptions = {
  stdio: false,
  profile: 'Full',
  logLevel: 'info',
  licenseDir: undefined,
};

/**
 * Parse the arguments slice passed after the node binary and script path
 * (i.e. `process.argv.slice(2)`).
 *
 * Supported flags:
 *   --stdio                        boolean, default false
 *   --profile <Full|Lite|Minimal|RPG-only>
 *                                  default Full
 *   --mcp-log-level <debug|info|warn|error>
 *                                  default info
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
 * Driver: parse args and print a stub acknowledgement to stderr. Real
 * transport wiring (WebSocket, UDP, stdio JSON-RPC) lands later.
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

  // Startup license scan: determine unlocked tool modules so profile
  // filtering can expose subsystem tools once the Godot-side activation
  // has written a record. I/O is best-effort; a missing directory or
  // malformed files never block startup.
  const unlocked = await discoverUnlockedModules(options);
  process.stderr.write(
    `[license] unlocked modules: [${[...unlocked].sort().join(', ')}]\n`,
  );

  const message =
    `[@forgekit/core-mcp] skeleton — ` +
    `stdio=${options.stdio}, profile=${options.profile}, logLevel=${options.logLevel}. ` +
    `Transport bridges are not wired up yet.`;
  process.stderr.write(`${message}\n`);
  return 0;
}

async function discoverUnlockedModules(options: CliOptions): Promise<ReadonlySet<string>> {
  const [{ resolveLicenseDir, loadActiveLicenses, unlockedModulesFromLicenses }] =
    await Promise.all([import('./licensing/startup.js')]);
  try {
    const dir = await resolveLicenseDir({
      projectRoot: process.cwd(),
      licenseDir: options.licenseDir,
    });
    const records = await loadActiveLicenses(dir, {
      logger: { warn: (msg: string) => process.stderr.write(`${msg}\n`) },
    });
    return unlockedModulesFromLicenses(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[license] discovery failed: ${message}\n`);
    return new Set<string>();
  }
}

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
      process.stderr.write(`[@forgekit/core-mcp] error: ${message}\n`);
      process.exit(1);
    });
}
