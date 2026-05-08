/**
 * Server-side implementations of the seven runtime-channel
 * `inventory.*` MCP tools.
 *
 *   inventory.add_item(item_id, amount)                                    → runtime
 *   inventory.remove_item(item_id, amount)                                 → runtime
 *   inventory.get_count(item_id)                                           → runtime
 *   inventory.snapshot()                                                   → runtime
 *   inventory.clear(owner?)                                                → runtime
 *   inventory.transfer(from_owner, to_owner, item_id, amount)              → runtime
 *   inventory.set_capacity(owner, capacity)                                → runtime
 *
 * All seven tools target the runtime channel: when the game was
 * launched with `--mcp-bridge`, the MCP_Runtime_Bridge receives a UDP
 * JSON-RPC packet, operates on the live `InventorySystem`, and returns
 * the reply. The server layer is a thin shim: validate parameters,
 * forward to the dispatcher, return the dispatcher reply verbatim.
 *
 * The `dispatch` dependency is injected so the tools are unit-testable
 * without a live UDP transport.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for the inventory family. The concrete transport
 * (UDP client) knows how to route `method` to the runtime bridge and
 * deserialize the JSON-RPC reply.
 */
export type InventoryDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface InventoryDeps {
  dispatch?: InventoryDispatcher;
}

/**
 * Sentinel capacity value meaning "no cap". Mirrors
 * `InventorySystem.UNLIMITED_CAPACITY` in the GDScript subsystem.
 */
export const UNLIMITED_CAPACITY = -1 as const;

// ---------------------------------------------------------------------------
// inventory.add_item
// ---------------------------------------------------------------------------

export interface AddItemParams {
  item_id: string;
  amount: number;
}

export interface AddItemResult {
  count?: number;
  [key: string]: unknown;
}

export async function addItem(
  params: AddItemParams,
  deps: InventoryDeps,
): Promise<AddItemResult> {
  const dispatch = requireDispatcher(deps, 'inventory.add_item');
  requireNonBlankString(params.item_id, 'item_id');
  requireNonNegativeInteger(params.amount, 'amount');

  const reply = await dispatch('inventory.add_item', {
    item_id: params.item_id,
    amount: params.amount,
  });
  return reply as AddItemResult;
}

// ---------------------------------------------------------------------------
// inventory.remove_item
// ---------------------------------------------------------------------------

export interface RemoveItemParams {
  item_id: string;
  amount: number;
}

export interface RemoveItemResult {
  count?: number;
  [key: string]: unknown;
}

export async function removeItem(
  params: RemoveItemParams,
  deps: InventoryDeps,
): Promise<RemoveItemResult> {
  const dispatch = requireDispatcher(deps, 'inventory.remove_item');
  requireNonBlankString(params.item_id, 'item_id');
  requireNonNegativeInteger(params.amount, 'amount');

  const reply = await dispatch('inventory.remove_item', {
    item_id: params.item_id,
    amount: params.amount,
  });
  return reply as RemoveItemResult;
}

// ---------------------------------------------------------------------------
// inventory.get_count
// ---------------------------------------------------------------------------

export interface GetCountParams {
  item_id: string;
}

export interface GetCountResult {
  count?: number;
  [key: string]: unknown;
}

export async function getCount(
  params: GetCountParams,
  deps: InventoryDeps,
): Promise<GetCountResult> {
  const dispatch = requireDispatcher(deps, 'inventory.get_count');
  requireNonBlankString(params.item_id, 'item_id');

  const reply = await dispatch('inventory.get_count', {
    item_id: params.item_id,
  });
  return reply as GetCountResult;
}

// ---------------------------------------------------------------------------
// inventory.snapshot
// ---------------------------------------------------------------------------

export interface SnapshotParams {
  // No parameters.
}

export interface SnapshotResult {
  items?: Record<string, number>;
  [key: string]: unknown;
}

export async function snapshot(
  _params: SnapshotParams,
  deps: InventoryDeps,
): Promise<SnapshotResult> {
  const dispatch = requireDispatcher(deps, 'inventory.snapshot');
  const reply = await dispatch('inventory.snapshot', {});
  return reply as SnapshotResult;
}

// ---------------------------------------------------------------------------
// inventory.clear
// ---------------------------------------------------------------------------

export interface ClearInventoryParams {
  /**
   * Optional owner id. When omitted, the runtime bridge clears the
   * default owner's bag. Other owners are untouched either way.
   */
  owner?: string;
}

export interface ClearInventoryResult {
  [key: string]: unknown;
}

export async function clearInventory(
  params: ClearInventoryParams,
  deps: InventoryDeps,
): Promise<ClearInventoryResult> {
  const dispatch = requireDispatcher(deps, 'inventory.clear');
  const payload: Record<string, unknown> = {};
  if (params.owner !== undefined) {
    requireNonBlankString(params.owner, 'owner');
    payload.owner = params.owner;
  }

  const reply = await dispatch('inventory.clear', payload);
  return reply as ClearInventoryResult;
}

// ---------------------------------------------------------------------------
// inventory.transfer
// ---------------------------------------------------------------------------

export interface TransferParams {
  from_owner: string;
  to_owner: string;
  item_id: string;
  amount: number;
}

export interface TransferResult {
  ok?: boolean;
  [key: string]: unknown;
}

export async function transfer(
  params: TransferParams,
  deps: InventoryDeps,
): Promise<TransferResult> {
  const dispatch = requireDispatcher(deps, 'inventory.transfer');
  requireNonBlankString(params.from_owner, 'from_owner');
  requireNonBlankString(params.to_owner, 'to_owner');
  requireNonBlankString(params.item_id, 'item_id');
  requireNonNegativeInteger(params.amount, 'amount');

  const reply = await dispatch('inventory.transfer', {
    from_owner: params.from_owner,
    to_owner: params.to_owner,
    item_id: params.item_id,
    amount: params.amount,
  });
  return reply as TransferResult;
}

// ---------------------------------------------------------------------------
// inventory.set_capacity
// ---------------------------------------------------------------------------

export interface SetCapacityParams {
  owner: string;
  /**
   * Maximum number of items `owner` may hold in total. Pass
   * `UNLIMITED_CAPACITY` (-1) to remove any previously configured cap.
   * Other negative values are rejected.
   */
  capacity: number;
}

export interface SetCapacityResult {
  [key: string]: unknown;
}

export async function setCapacity(
  params: SetCapacityParams,
  deps: InventoryDeps,
): Promise<SetCapacityResult> {
  const dispatch = requireDispatcher(deps, 'inventory.set_capacity');
  requireNonBlankString(params.owner, 'owner');
  requireCapacity(params.capacity);

  const reply = await dispatch('inventory.set_capacity', {
    owner: params.owner,
    capacity: params.capacity,
  });
  return reply as SetCapacityResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: InventoryDeps,
  toolName: string,
): InventoryDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires a runtime dispatcher; the UDP transport is not connected.`,
    );
  }
  return deps.dispatch;
}

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}

function requireNonNegativeInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"${field}" must be a finite non-negative integer (got ${JSON.stringify(value)}).`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new ToolInputError(
      `"${field}" must be an integer (got ${value}).`,
    );
  }
  if (value < 0) {
    throw new ToolInputError(
      `"${field}" must be >= 0 (got ${value}).`,
    );
  }
}

function requireCapacity(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"capacity" must be a finite integer (got ${JSON.stringify(value)}).`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new ToolInputError(
      `"capacity" must be an integer (got ${value}).`,
    );
  }
  if (value < UNLIMITED_CAPACITY) {
    throw new ToolInputError(
      `"capacity" must be >= ${UNLIMITED_CAPACITY} (use ${UNLIMITED_CAPACITY} to remove the cap); got ${value}.`,
    );
  }
}
