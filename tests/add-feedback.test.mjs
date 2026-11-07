import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title><link>https://example.org</link>' +
  '<item><title>Hello</title><link>https://example.org/1</link><guid>1</guid><pubDate>Tue, 03 Nov 2026 10:00:00 +0800</pubDate></item>' +
  '</channel></rss>';

async function harness(t, fetchImpl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feeds-add-'));
  const cleanups = [];
  let definition;
  const connection = { fetch: { register() { return () => {}; } } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const cleanup of cleanups) {
      try { cleanup(); } catch { /* ignore */ }
    }
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  apply({
    connection,
    get: () => connection,
    tools: { register(tool) { definition = tool; return () => {}; } },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return () => {}; },
  }, { dataDir: dir, refreshMinutes: 30 });
  assert.ok(definition, 'feeds tool registered');
  return definition;
}

test('add reports a saved subscription whose first fetch failed', async (t) => {
  const definition = await harness(t, async () => new Response('<html><body>not a feed</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }));
  const value = await definition.execute({ action: 'add', url: 'https://example.org/broken' });
  assert.equal(value.added, true);
  assert.equal(value.refreshing, false);
  assert.equal(value.fetched, false);
  assert.match(String(value.error), /unrecognized feed format/i);
  const text = definition.output.render({ action: 'add', url: 'https://example.org/broken' }, value)[0].text;
  assert.match(text, /订阅已保存，但首次抓取失败/);
  assert.doesNotMatch(text, /已订阅并抓取成功/);
});

test('add reports a successful first fetch with its item count', async (t) => {
  const definition = await harness(t, async () => new Response(RSS, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  }));
  const value = await definition.execute({ action: 'add', url: 'https://example.org/feed' });
  assert.equal(value.added, true);
  assert.equal(value.fetched, true);
  assert.equal(value.error, null);
  assert.equal(value.itemCount, 1);
  const text = definition.output.render({ action: 'add', url: 'https://example.org/feed' }, value)[0].text;
  assert.match(text, /已订阅并抓取成功/);
  assert.match(text, /1 条/);
});

test('add reports an existing subscription without claiming a new fetch', async (t) => {
  const definition = await harness(t, async () => new Response(RSS, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
  }));
  await definition.execute({ action: 'add', url: 'https://example.org/feed' });
  const duplicate = await definition.execute({ action: 'add', url: 'https://example.org/feed' });
  assert.equal(duplicate.added, false);
  const text = definition.output.render({ action: 'add', url: 'https://example.org/feed' }, duplicate)[0].text;
  assert.match(text, /已存在/);
});


test('add render distinguishes an unfinished first fetch from a failure', async (t) => {
  const definition = await harness(t, async () => new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
  const text = definition.output.render({ action: 'add', url: 'https://example.org/x' }, {
    added: true, fetched: false, refreshing: false, error: null, itemCount: 0,
  })[0].text;
  assert.match(text, /首次抓取尚未完成/);
  assert.doesNotMatch(text, /首次抓取失败/);
});
