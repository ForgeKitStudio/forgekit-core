/**
 * Tests for the eight `crafting.*` MCP tools exposed on the runtime
 * and editor channels (task 3.15).
 *
 *   crafting.execute(recipe_id)
 *   crafting.list_recipes(filter?)
 *   crafting.get_recipe(recipe_id)
 *   crafting.create_recipe(id, inputs, outputs, duration_seconds)
 *   crafting.update_recipe(id, patch)
 *   crafting.delete_recipe(id)
 *   crafting.validate_recipe(id | fields)
 *   crafting.simulate_cost(recipe_id, iterations?)
 *
 * The server layer is a thin shim: validate parameters, forward the
 * call to the injected dispatcher, return the dispatcher reply
 * verbatim. The transport (UDP for runtime, WebSocket for editor) is
 * abstracted behind `CraftingDispatcher` so the tools are
 * unit-testable without a live Godot instance.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createRecipe,
  deleteRecipe,
  execute,
  getRecipe,
  listRecipes,
  simulateCost,
  updateRecipe,
  validateRecipe,
  type CraftingDispatcher,
} from '../../../src/tools/runtime_bridge/crafting.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

describe('execute', () => {
  it('forwards recipe_id and returns the dispatcher reply', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      status: 'ok',
      outputs: [{ item_id: 'iron_ingot', amount: 1 }],
      missing_items: [],
    });
    const result = await execute({ recipe_id: 'iron_ingot' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.execute', {
      recipe_id: 'iron_ingot',
    });
    expect(result).toEqual({
      status: 'ok',
      outputs: [{ item_id: 'iron_ingot', amount: 1 }],
      missing_items: [],
    });
  });

  it('rejects an empty recipe_id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(execute({ recipe_id: '' }, { dispatch })).rejects.toThrow(
      ToolInputError,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string recipe_id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      execute(
        { recipe_id: 42 as unknown as string },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(execute({ recipe_id: 'iron_ingot' }, {})).rejects.toThrow(
      ToolInputError,
    );
  });
});

describe('listRecipes', () => {
  it('forwards an empty params payload when no filter is given', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      recipes: [],
    });
    const result = await listRecipes({}, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.list_recipes', {});
    expect(result).toEqual({ recipes: [] });
  });

  it('forwards the filter when provided', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      recipes: [{ id: 'iron_ingot' }],
    });
    await listRecipes({ filter: 'iron' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.list_recipes', {
      filter: 'iron',
    });
  });

  it('rejects a non-string filter', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      listRecipes(
        { filter: 5 as unknown as string },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(listRecipes({}, {})).rejects.toThrow(ToolInputError);
  });
});

describe('getRecipe', () => {
  it('forwards recipe_id and returns the dispatcher reply', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      id: 'iron_ingot',
      inputs: [{ item_id: 'iron_ore', amount: 2 }],
      outputs: [{ item_id: 'iron_ingot', amount: 1 }],
      duration_seconds: 0,
    });
    const result = await getRecipe(
      { recipe_id: 'iron_ingot' },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('crafting.get_recipe', {
      recipe_id: 'iron_ingot',
    });
    expect(result).toMatchObject({ id: 'iron_ingot' });
  });

  it('rejects an empty recipe_id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      getRecipe({ recipe_id: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      getRecipe({ recipe_id: 'iron_ingot' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('createRecipe', () => {
  it('forwards all four fields and returns the dispatcher reply', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      saved_path: 'res://addons/forgekit_rpg/crafting/recipes/iron_ingot.tres',
    });
    const result = await createRecipe(
      {
        id: 'iron_ingot',
        inputs: [{ item_id: 'iron_ore', amount: 2 }],
        outputs: [{ item_id: 'iron_ingot', amount: 1 }],
        duration_seconds: 0.0,
      },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('crafting.create_recipe', {
      id: 'iron_ingot',
      inputs: [{ item_id: 'iron_ore', amount: 2 }],
      outputs: [{ item_id: 'iron_ingot', amount: 1 }],
      duration_seconds: 0.0,
    });
    expect(result).toMatchObject({ saved_path: expect.stringContaining('iron_ingot.tres') });
  });

  it('rejects an empty id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      createRecipe(
        {
          id: '',
          inputs: [],
          outputs: [{ item_id: 'iron_ingot', amount: 1 }],
          duration_seconds: 0.0,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects non-array inputs', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      createRecipe(
        {
          id: 'x',
          inputs: 'not an array' as unknown as unknown[],
          outputs: [],
          duration_seconds: 0.0,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a negative duration', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      createRecipe(
        {
          id: 'x',
          inputs: [],
          outputs: [{ item_id: 'y', amount: 1 }],
          duration_seconds: -1.0,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-finite duration', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      createRecipe(
        {
          id: 'x',
          inputs: [],
          outputs: [{ item_id: 'y', amount: 1 }],
          duration_seconds: Number.POSITIVE_INFINITY,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('updateRecipe', () => {
  it('forwards id and patch and returns the dispatcher reply', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      applied: true,
      previous: { id: 'iron_ingot', duration_seconds: 0.0 },
    });
    const result = await updateRecipe(
      { id: 'iron_ingot', patch: { duration_seconds: 2.5 } },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('crafting.update_recipe', {
      id: 'iron_ingot',
      patch: { duration_seconds: 2.5 },
    });
    expect(result).toMatchObject({ applied: true });
  });

  it('rejects an empty id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      updateRecipe({ id: '', patch: {} }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-object patch', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      updateRecipe(
        {
          id: 'iron_ingot',
          patch: 'not an object' as unknown as Record<string, unknown>,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      updateRecipe({ id: 'iron_ingot', patch: {} }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('deleteRecipe', () => {
  it('forwards id and returns the dispatcher reply', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      deleted: true,
    });
    const result = await deleteRecipe({ id: 'iron_ingot' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.delete_recipe', {
      id: 'iron_ingot',
    });
    expect(result).toEqual({ deleted: true });
  });

  it('rejects an empty id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      deleteRecipe({ id: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(deleteRecipe({ id: 'iron_ingot' }, {})).rejects.toThrow(
      ToolInputError,
    );
  });
});

describe('validateRecipe', () => {
  it('forwards id when provided', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      ok: true,
      errors: [],
    });
    await validateRecipe({ id: 'iron_ingot' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.validate_recipe', {
      id: 'iron_ingot',
    });
  });

  it('forwards fields when provided', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      ok: true,
      errors: [],
    });
    const fields = {
      id: 'iron_ingot',
      inputs: [{ item_id: 'iron_ore', amount: 2 }],
      outputs: [{ item_id: 'iron_ingot', amount: 1 }],
      duration_seconds: 0.0,
    };
    await validateRecipe({ fields }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.validate_recipe', {
      fields,
    });
  });

  it('forwards both when supplied — runtime picks the one it needs', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      ok: true,
      errors: [],
    });
    await validateRecipe(
      { id: 'iron_ingot', fields: { id: 'iron_ingot' } },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('crafting.validate_recipe', {
      id: 'iron_ingot',
      fields: { id: 'iron_ingot' },
    });
  });

  it('rejects a call with neither id nor fields', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(validateRecipe({}, { dispatch })).rejects.toThrow(
      ToolInputError,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      validateRecipe({ id: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects non-object fields', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      validateRecipe(
        {
          fields: 'not a dict' as unknown as Record<string, unknown>,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      validateRecipe({ id: 'iron_ingot' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('simulateCost', () => {
  it('forwards recipe_id and iterations', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({
      avg_inputs: { iron_ore: 2 },
      avg_outputs: { iron_ingot: 1 },
      iterations: 50,
    });
    const result = await simulateCost(
      { recipe_id: 'iron_ingot', iterations: 50 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('crafting.simulate_cost', {
      recipe_id: 'iron_ingot',
      iterations: 50,
    });
    expect(result).toMatchObject({ iterations: 50 });
  });

  it('omits iterations from the payload when not provided', async () => {
    const dispatch: CraftingDispatcher = vi.fn().mockResolvedValue({});
    await simulateCost({ recipe_id: 'iron_ingot' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('crafting.simulate_cost', {
      recipe_id: 'iron_ingot',
    });
  });

  it('rejects an empty recipe_id', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      simulateCost({ recipe_id: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects iterations <= 0', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      simulateCost(
        { recipe_id: 'iron_ingot', iterations: 0 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-integer iterations', async () => {
    const dispatch: CraftingDispatcher = vi.fn();
    await expect(
      simulateCost(
        { recipe_id: 'iron_ingot', iterations: 1.5 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      simulateCost({ recipe_id: 'iron_ingot' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});
