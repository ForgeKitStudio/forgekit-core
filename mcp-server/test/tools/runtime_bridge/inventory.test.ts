/**
 * Tests for the seven `inventory.*` MCP tools exposed on the runtime
 * channel.
 *
 *   inventory.add_item(item_id, amount)
 *   inventory.remove_item(item_id, amount)
 *   inventory.get_count(item_id)
 *   inventory.snapshot()
 *   inventory.clear(owner?)
 *   inventory.transfer(from_owner, to_owner, item_id, amount)
 *   inventory.set_capacity(owner, capacity)
 *
 * Each tool targets the runtime channel: when the game was launched
 * with `--mcp-bridge`, the MCP_Runtime_Bridge receives a UDP JSON-RPC
 * packet, operates on the live `InventorySystem`, and returns the reply.
 * The server layer is a thin shim: validate parameters, default omitted
 * optional fields, forward to the dispatcher, return the dispatcher
 * reply verbatim.
 *
 * The `dispatch` dependency is injected so the tools are unit-testable
 * without a live UDP transport.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  addItem,
  clearInventory,
  getCount,
  removeItem,
  setCapacity,
  snapshot,
  transfer,
  UNLIMITED_CAPACITY,
  type InventoryDispatcher,
} from '../../../src/tools/runtime_bridge/inventory.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

describe('addItem', () => {
  it('forwards item_id and amount and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({ count: 3 });
    const result = await addItem({ item_id: 'iron_ore', amount: 3 }, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('inventory.add_item', {
      item_id: 'iron_ore',
      amount: 3,
    });
    expect(result).toEqual({ count: 3 });
  });

  it('accepts amount === 0 as the minimum valid value', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({ count: 0 });
    await addItem({ item_id: 'iron_ore', amount: 0 }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.add_item', {
      item_id: 'iron_ore',
      amount: 0,
    });
  });

  it('rejects a missing item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      addItem({ amount: 1 } as unknown as { item_id: string; amount: number }, {
        dispatch,
      }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      addItem({ item_id: '', amount: 1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      addItem(
        { item_id: 7 as unknown as string, amount: 1 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      addItem({ item_id: 'iron_ore', amount: -1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amount', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      addItem({ item_id: 'iron_ore', amount: 1.5 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      addItem({ item_id: 'iron_ore', amount: 1 }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('removeItem', () => {
  it('forwards item_id and amount and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({ count: 2 });
    const result = await removeItem(
      { item_id: 'iron_ore', amount: 1 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('inventory.remove_item', {
      item_id: 'iron_ore',
      amount: 1,
    });
    expect(result).toEqual({ count: 2 });
  });

  it('rejects a negative amount', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      removeItem({ item_id: 'iron_ore', amount: -1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      removeItem({ item_id: '', amount: 1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      removeItem({ item_id: 'iron_ore', amount: 1 }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('getCount', () => {
  it('forwards item_id and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({ count: 4 });
    const result = await getCount({ item_id: 'iron_ore' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.get_count', {
      item_id: 'iron_ore',
    });
    expect(result).toEqual({ count: 4 });
  });

  it('rejects a missing item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      getCount({} as unknown as { item_id: string }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      getCount({ item_id: 'iron_ore' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('snapshot', () => {
  it('forwards an empty params payload and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({
      items: { iron_ore: 2, iron_ingot: 1 },
    });
    const result = await snapshot({}, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.snapshot', {});
    expect(result).toEqual({ items: { iron_ore: 2, iron_ingot: 1 } });
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(snapshot({}, {})).rejects.toThrow(ToolInputError);
  });
});

describe('clearInventory', () => {
  it('forwards an empty params payload when owner is omitted', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({});
    const result = await clearInventory({}, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.clear', {});
    expect(result).toEqual({});
  });

  it('forwards the owner when provided', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({});
    await clearInventory({ owner: 'chest' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.clear', { owner: 'chest' });
  });

  it('rejects an empty owner string', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      clearInventory({ owner: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string owner', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      clearInventory({ owner: 42 as unknown as string }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(clearInventory({}, {})).rejects.toThrow(ToolInputError);
  });
});

describe('transfer', () => {
  it('forwards all four fields and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({ ok: true });
    const result = await transfer(
      {
        from_owner: 'player',
        to_owner: 'chest',
        item_id: 'iron_ore',
        amount: 2,
      },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('inventory.transfer', {
      from_owner: 'player',
      to_owner: 'chest',
      item_id: 'iron_ore',
      amount: 2,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects an empty from_owner', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      transfer(
        { from_owner: '', to_owner: 'chest', item_id: 'iron_ore', amount: 1 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty to_owner', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      transfer(
        { from_owner: 'player', to_owner: '', item_id: 'iron_ore', amount: 1 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty item_id', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      transfer(
        { from_owner: 'player', to_owner: 'chest', item_id: '', amount: 1 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      transfer(
        {
          from_owner: 'player',
          to_owner: 'chest',
          item_id: 'iron_ore',
          amount: -1,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amount', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      transfer(
        {
          from_owner: 'player',
          to_owner: 'chest',
          item_id: 'iron_ore',
          amount: 2.5,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      transfer(
        {
          from_owner: 'player',
          to_owner: 'chest',
          item_id: 'iron_ore',
          amount: 1,
        },
        {},
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('setCapacity', () => {
  it('forwards owner and capacity and returns the dispatcher reply', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({});
    const result = await setCapacity(
      { owner: 'chest', capacity: 32 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('inventory.set_capacity', {
      owner: 'chest',
      capacity: 32,
    });
    expect(result).toEqual({});
  });

  it('accepts UNLIMITED_CAPACITY (-1) as a valid capacity', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({});
    await setCapacity(
      { owner: 'chest', capacity: UNLIMITED_CAPACITY },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('inventory.set_capacity', {
      owner: 'chest',
      capacity: -1,
    });
  });

  it('accepts capacity === 0', async () => {
    const dispatch: InventoryDispatcher = vi.fn().mockResolvedValue({});
    await setCapacity({ owner: 'chest', capacity: 0 }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('inventory.set_capacity', {
      owner: 'chest',
      capacity: 0,
    });
  });

  it('rejects a capacity below -1', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      setCapacity({ owner: 'chest', capacity: -2 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-integer capacity', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      setCapacity({ owner: 'chest', capacity: 1.5 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty owner', async () => {
    const dispatch: InventoryDispatcher = vi.fn();
    await expect(
      setCapacity({ owner: '', capacity: 10 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      setCapacity({ owner: 'chest', capacity: 10 }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});
