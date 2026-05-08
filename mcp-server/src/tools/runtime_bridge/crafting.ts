/**
 * Server-side implementations of the eight `crafting.*` MCP tools.
 *
 *   crafting.execute(recipe_id)                                    → runtime
 *   crafting.list_recipes(filter?)                                 → editor, runtime
 *   crafting.get_recipe(recipe_id)                                 → editor, runtime
 *   crafting.create_recipe(id, inputs, outputs, duration_seconds)  → editor
 *   crafting.update_recipe(id, patch)                              → editor
 *   crafting.delete_recipe(id)                                     → editor
 *   crafting.validate_recipe(id | fields)                          → editor, cli
 *   crafting.simulate_cost(recipe_id, iterations?)                 → runtime
 *
 * The server layer is a thin shim: validate parameters, forward to the
 * dispatcher, return the dispatcher reply verbatim. The transport
 * (UDP for runtime, WebSocket for editor, headless Godot spawn for
 * cli) is abstracted behind `CraftingDispatcher` so the tools are
 * unit-testable without a live Godot instance.
 *
 * Editor-channel mutations (`create_recipe`, `update_recipe`,
 * `delete_recipe`) are wrapped by the GDScript-side `McpUndoRedoWrapper`
 * so every AI-driven change can be undone with a single Ctrl+Z. The
 * TypeScript shim only produces the outbound payload; wrapping happens
 * on the editor side.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for the crafting family. The concrete transport
 * (UDP client for runtime calls, WebSocket client for editor calls)
 * knows how to route `method` to the appropriate channel and
 * deserialize the JSON-RPC reply.
 */
export type CraftingDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface CraftingDeps {
  dispatch?: CraftingDispatcher;
}

/** Shape of a single `{item_id, amount}` entry in inputs/outputs. */
export interface RecipeEntry {
  item_id: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// crafting.execute
// ---------------------------------------------------------------------------

export interface ExecuteParams {
  recipe_id: string;
}

export interface ExecuteResult {
  status?: 'ok' | 'insufficient_inputs' | 'unknown_recipe' | 'unknown_error';
  missing_items?: ReadonlyArray<RecipeEntry>;
  outputs?: ReadonlyArray<RecipeEntry>;
  [key: string]: unknown;
}

export async function execute(
  params: ExecuteParams,
  deps: CraftingDeps,
): Promise<ExecuteResult> {
  const dispatch = requireDispatcher(deps, 'crafting.execute');
  requireNonBlankString(params.recipe_id, 'recipe_id');
  const reply = await dispatch('crafting.execute', {
    recipe_id: params.recipe_id,
  });
  return reply as ExecuteResult;
}

// ---------------------------------------------------------------------------
// crafting.list_recipes
// ---------------------------------------------------------------------------

export interface ListRecipesParams {
  /** Optional substring filter matched against each recipe's `id`. */
  filter?: string;
}

export interface ListRecipesResult {
  recipes?: ReadonlyArray<Record<string, unknown>>;
  [key: string]: unknown;
}

export async function listRecipes(
  params: ListRecipesParams,
  deps: CraftingDeps,
): Promise<ListRecipesResult> {
  const dispatch = requireDispatcher(deps, 'crafting.list_recipes');
  const payload: Record<string, unknown> = {};
  if (params.filter !== undefined) {
    if (typeof params.filter !== 'string') {
      throw new ToolInputError(
        `"filter" must be a string (got ${JSON.stringify(params.filter)}).`,
      );
    }
    payload.filter = params.filter;
  }
  const reply = await dispatch('crafting.list_recipes', payload);
  return reply as ListRecipesResult;
}

// ---------------------------------------------------------------------------
// crafting.get_recipe
// ---------------------------------------------------------------------------

export interface GetRecipeParams {
  recipe_id: string;
}

export interface GetRecipeResult {
  id?: string;
  inputs?: ReadonlyArray<RecipeEntry>;
  outputs?: ReadonlyArray<RecipeEntry>;
  duration_seconds?: number;
  [key: string]: unknown;
}

export async function getRecipe(
  params: GetRecipeParams,
  deps: CraftingDeps,
): Promise<GetRecipeResult> {
  const dispatch = requireDispatcher(deps, 'crafting.get_recipe');
  requireNonBlankString(params.recipe_id, 'recipe_id');
  const reply = await dispatch('crafting.get_recipe', {
    recipe_id: params.recipe_id,
  });
  return reply as GetRecipeResult;
}

// ---------------------------------------------------------------------------
// crafting.create_recipe
// ---------------------------------------------------------------------------

export interface CreateRecipeParams {
  id: string;
  inputs: ReadonlyArray<RecipeEntry | Record<string, unknown>>;
  outputs: ReadonlyArray<RecipeEntry | Record<string, unknown>>;
  duration_seconds: number;
}

export interface CreateRecipeResult {
  saved_path?: string;
  [key: string]: unknown;
}

export async function createRecipe(
  params: CreateRecipeParams,
  deps: CraftingDeps,
): Promise<CreateRecipeResult> {
  const dispatch = requireDispatcher(deps, 'crafting.create_recipe');
  requireNonBlankString(params.id, 'id');
  requireArray(params.inputs, 'inputs');
  requireArray(params.outputs, 'outputs');
  requireNonNegativeFiniteNumber(params.duration_seconds, 'duration_seconds');

  const reply = await dispatch('crafting.create_recipe', {
    id: params.id,
    inputs: params.inputs,
    outputs: params.outputs,
    duration_seconds: params.duration_seconds,
  });
  return reply as CreateRecipeResult;
}

// ---------------------------------------------------------------------------
// crafting.update_recipe
// ---------------------------------------------------------------------------

export interface UpdateRecipeParams {
  id: string;
  patch: Record<string, unknown>;
}

export interface UpdateRecipeResult {
  applied?: boolean;
  previous?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function updateRecipe(
  params: UpdateRecipeParams,
  deps: CraftingDeps,
): Promise<UpdateRecipeResult> {
  const dispatch = requireDispatcher(deps, 'crafting.update_recipe');
  requireNonBlankString(params.id, 'id');
  requirePlainObject(params.patch, 'patch');

  const reply = await dispatch('crafting.update_recipe', {
    id: params.id,
    patch: params.patch,
  });
  return reply as UpdateRecipeResult;
}

// ---------------------------------------------------------------------------
// crafting.delete_recipe
// ---------------------------------------------------------------------------

export interface DeleteRecipeParams {
  id: string;
}

export interface DeleteRecipeResult {
  deleted?: boolean;
  [key: string]: unknown;
}

export async function deleteRecipe(
  params: DeleteRecipeParams,
  deps: CraftingDeps,
): Promise<DeleteRecipeResult> {
  const dispatch = requireDispatcher(deps, 'crafting.delete_recipe');
  requireNonBlankString(params.id, 'id');
  const reply = await dispatch('crafting.delete_recipe', { id: params.id });
  return reply as DeleteRecipeResult;
}

// ---------------------------------------------------------------------------
// crafting.validate_recipe
// ---------------------------------------------------------------------------

export interface ValidateRecipeParams {
  /** Validate the on-disk `.tres` for this id. */
  id?: string;
  /** Validate these transient fields without touching the filesystem. */
  fields?: Record<string, unknown>;
}

export interface ValidateRecipeResult {
  ok?: boolean;
  errors?: ReadonlyArray<string>;
  [key: string]: unknown;
}

export async function validateRecipe(
  params: ValidateRecipeParams,
  deps: CraftingDeps,
): Promise<ValidateRecipeResult> {
  const dispatch = requireDispatcher(deps, 'crafting.validate_recipe');
  const hasId = params.id !== undefined;
  const hasFields = params.fields !== undefined;
  if (!hasId && !hasFields) {
    throw new ToolInputError(
      'crafting.validate_recipe requires either "id" or "fields".',
    );
  }
  const payload: Record<string, unknown> = {};
  if (hasId) {
    requireNonBlankString(params.id, 'id');
    payload.id = params.id;
  }
  if (hasFields) {
    requirePlainObject(params.fields, 'fields');
    payload.fields = params.fields;
  }
  const reply = await dispatch('crafting.validate_recipe', payload);
  return reply as ValidateRecipeResult;
}

// ---------------------------------------------------------------------------
// crafting.simulate_cost
// ---------------------------------------------------------------------------

export interface SimulateCostParams {
  recipe_id: string;
  /**
   * Number of dry-run iterations. Defaults to 100 on the runtime side
   * when omitted; positive integers are required when supplied.
   */
  iterations?: number;
}

export interface SimulateCostResult {
  avg_inputs?: Record<string, number>;
  avg_outputs?: Record<string, number>;
  iterations?: number;
  [key: string]: unknown;
}

export async function simulateCost(
  params: SimulateCostParams,
  deps: CraftingDeps,
): Promise<SimulateCostResult> {
  const dispatch = requireDispatcher(deps, 'crafting.simulate_cost');
  requireNonBlankString(params.recipe_id, 'recipe_id');
  const payload: Record<string, unknown> = {
    recipe_id: params.recipe_id,
  };
  if (params.iterations !== undefined) {
    requirePositiveInteger(params.iterations, 'iterations');
    payload.iterations = params.iterations;
  }
  const reply = await dispatch('crafting.simulate_cost', payload);
  return reply as SimulateCostResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: CraftingDeps,
  toolName: string,
): CraftingDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires a crafting dispatcher; the transport is not connected.`,
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

function requireArray(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new ToolInputError(
      `"${field}" must be an array (got ${JSON.stringify(value)}).`,
    );
  }
}

function requirePlainObject(value: unknown, field: string): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new ToolInputError(
      `"${field}" must be an object (got ${JSON.stringify(value)}).`,
    );
  }
}

function requireNonNegativeFiniteNumber(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"${field}" must be a finite number (got ${JSON.stringify(value)}).`,
    );
  }
  if (value < 0) {
    throw new ToolInputError(
      `"${field}" must be >= 0 (got ${value}).`,
    );
  }
}

function requirePositiveInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"${field}" must be a finite integer (got ${JSON.stringify(value)}).`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new ToolInputError(`"${field}" must be an integer (got ${value}).`);
  }
  if (value <= 0) {
    throw new ToolInputError(`"${field}" must be > 0 (got ${value}).`);
  }
}
