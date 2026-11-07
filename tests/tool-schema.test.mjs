import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

async function harness(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feeds-tool-'));
  const cleanups = [];
  let tool;
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch { /* ignore */ } }
    await fs.rm(dir, { recursive: true, force: true });
  });
  apply({
    connection: null,
    get: () => undefined,
    tools: { register(definition) { tool = definition; return () => {}; } },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return () => {}; },
  }, { dataDir: dir, refreshMinutes: 0 });
  assert.ok(tool, 'tool registered');
  return tool;
}

test('the tool schema declares every management parameter the executor reads', async t => {
  const tool = await harness(t);
  const props = tool.parameters.properties;
  for (const name of ['action', 'name', 'newName', 'moveTo', 'op', 'mode', 'url', 'title', 'category', 'feedId', 'path']) {
    assert.ok(props[name], `missing parameter ${name}`);
  }
  for (const action of ['update', 'category', 'import', 'add', 'remove']) {
    assert.ok(tool.parameters.properties.action.enum.includes(action), `missing action ${action}`);
  }
  assert.equal(tool.parameters.additionalProperties, false);
});

test('category create/rename/delete work through the declared name parameter', async t => {
  const tool = await harness(t);
  const created = await tool.execute({ action: 'category', op: 'create', name: 'Research' });
  assert.equal(created.created, true);
  const renamed = await tool.execute({ action: 'category', op: 'rename', name: 'Research', newName: 'Reading' });
  assert.equal(renamed.renamed, true);
  const deleted = await tool.execute({ action: 'category', op: 'delete', name: 'Reading' });
  assert.equal(deleted.deleted, true);
  await assert.rejects(tool.execute({ action: 'category', op: 'create' }), /category name/i);
});

test('update and category validation errors carry feeds/* codes', async t => {
  const tool = await harness(t);
  await assert.rejects(tool.execute({ action: 'update', feedId: 'missing', title: 'x' }), (error) => error.code === 'feeds/not-found');
  await assert.rejects(tool.execute({ action: 'category', op: 'rename', name: 'nope', newName: 'x' }), (error) => error.code === 'feeds/not-found');
});
