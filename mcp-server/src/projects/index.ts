/**
 * Public barrel export for the multi-project subsystem.
 *
 * Callers outside of `mcp-server/src/projects/` should import from
 * `'../projects/index.js'` (or just `'./projects'`) rather than
 * reaching into individual files.
 */

export {
  MAX_LABEL_LENGTH,
  MAX_WORKSPACES,
  WORKSPACE_ID_REGEX,
  validateLabel,
  validateWorkspaceId,
  type Workspace,
  type ValidationResult,
} from './workspace.js';
export {
  ProjectRegistry,
  nodeFileSystemAdapter,
  type FileSystemAdapter,
  type FromDiskOptions,
  type RegisterArgs,
} from './registry.js';
export {
  FileSystemWorkspacesPersistence,
  FORGEKIT_DIR_NAME,
  WORKSPACES_FILE_NAME,
  type FileSystemWorkspacesPersistenceOptions,
  type PersistenceLogger,
  type WorkspacesPersistence,
  type WorkspacesSnapshot,
} from './persistence.js';
export {
  WorkspaceChannelsRegistry,
  type WorkspaceChannels,
} from './workspace_channels.js';
export {
  autoRegisterDefault,
  type AutoRegisterOptions,
} from './auto_register.js';
export {
  resolveWorkspace,
  type ResolveWorkspaceParams,
  type ResolveWorkspaceResult,
} from './resolve_workspace.js';
export {
  InvalidProjectRootError,
  NoActiveWorkspaceError,
  PortRangeExhaustedError,
  ProjectError,
  ProjectRootAlreadyRegisteredError,
  WorkspaceAlreadyRegisteredError,
  WorkspaceLimitExceededError,
  WorkspaceNotFoundError,
  WorkspaceRootMismatchError,
  type ChannelName,
  type InvalidProjectRootReason,
  type PortRangeExhaustedDetails,
} from './errors.js';
