# dsh-feeds — Host ↔ Client contract

Package `dsh-feeds` (installed as a DeepSeek Harness profile bundle). Two halves share one package:

| Half | File | Owns |
| --- | --- | --- |
| Host | `index.js`, `feeds-core.js` | subscriptions, fetching/parsing, article extraction, durable state, the `feeds` agent tool, `/api/feeds/*` routes |
| Client | `client.js`, `locale/` | the `信息源` global sidebar panel (`sidebar.panellist` row + `main` panel) and its RPC calls |

This document is for contributors changing either half. It describes the wire shape the Client
consumes and the Host must keep compatible.

## RPC transport

Registered with `ctx.connection.fetch` as `POST /api/feeds/<endpoint>` with a JSON body:

```json
{ "type": "client-request", "rpcId": "<unique>", "payload": { } }
```

Response:

```json
{ "type": "server-response", "rpcId": "<same>", "result": { "ok": true, "value": {} } }
```

Failures use `{ "ok": false, "error": { "code": "feeds/…", "message": "…", "details": {} } }`.
`details` must always be an object: the DSH client transport validator rejects a failure envelope without it.
Codes in use:
`feeds/invalid-request`, `feeds/not-found`, `feeds/unknown-endpoint`, `feeds/unavailable`.

The Client calls `connection.rpc.call('/api', 'feeds/<endpoint>', payload, signal)`. This bundle declares
`connection` as a hard Host dependency, so the plugin is only active in profiles with the Web connection; the
Client still retries with backoff while the page boots before showing "host unavailable".

## Shared item shape

```ts
interface ItemView {
  id: string
  feedId: string
  feedTitle: string
  category: string
  title: string
  link: string
  summary: string            // plain text, <= 500 chars
  author: string | null
  published: number | null   // epoch ms
  fetchedAt: number | null   // epoch ms
  unread: boolean
  saved: boolean
}
```

## `feeds/snapshot`

Payload: `{}`, or `{ compact: true }` when only navigation/statistics are needed.

`compact: true` returns the same object with `items: []` (the Client then pages through `feeds/items`);
it keeps global `stats`. The Host starts a background refresh when the data is stale.

```ts
{
  generatedAt: number
  refreshing: boolean
  progress: { done: number; total: number; errors: number } | null
  categories: Array<{
    name: string
    unread: number
    feeds: Array<{
      id: string; title: string; site: string | null; url: string; category: string
      unread: number; itemCount: number
      error: string | null
      lastFetched: number | null
    }>
  }>
  items: ItemView[]                 // newest first; [] when compact
  stats: { feeds: number; items: number; saved: number; unread: number; failed: number }
  opml: { path: string | null; importedAt: number | null }
  refreshMinutes: number
  lastRefreshAt: number | null
}
```

## `feeds/items`

Server-side filtering, search and cursor pagination over the full cache (not just the snapshot).
Payload:

```ts
{
  category?: string
  feedId?: string
  query?: string            // title + summary search, case-insensitive
  unreadOnly?: boolean
  savedOnly?: boolean
  limit?: number            // default 80, clamped 1–200
  cursor?: string           // opaque value from a previous nextCursor
}
```

Result:

```ts
{ items: ItemView[]; total: number; nextCursor: string | null }
```

`total` is the number of matching items before pagination. A new item arriving between pages must not
produce duplicates (the cursor is stable on `published`/id); an invalid cursor is a request error.

## `feeds/save`

Payload: `{ ids: string[]; saved?: boolean }` — 1–2000 ids, `saved` defaults to `true`.

Result: `{ changed: number }`. Saved markers persist per source (`state.feeds[].saved`) and survive
refresh; unsubscribing removes them with the feed.

## `feeds/add`

Payload: `{ url: string; title?: string; category?: string }` — creates one subscription. `url` may omit
the scheme (https:// is assumed); only http(s) URLs are accepted. A missing/empty `category` becomes
`未分类`; a new category name is created implicitly. Result:

```ts
{
  added: boolean,            // false when the URL is already subscribed
  feedId?: string,
  category?: string,
  refreshing: boolean,       // first fetch still running
  fetched: boolean,          // first fetch finished without error
  itemCount: number,
  error: string | null,
}
```

## `feeds/update`

Payload: `{ feedId: string; title?: string; category?: string }` — renames a feed and/or moves it to a
category (created when new). Result: `{ updated: true, feed: { id, title, category } }`.

## `feeds/category`

Payload: `{ op: 'create' | 'rename' | 'delete'; name: string; newName?: string; moveTo?: string }`.

- `create` → `{ created, name, categories }` (empty categories are stored explicitly and render in the
  sources list with no feeds)
- `rename` → `{ renamed, merged, name, moved, categories }`; renaming onto an existing name merges the
  two categories
- `delete` → `{ deleted, name, moved, moveTo, categories }`; a non-empty category requires `moveTo` and
  its feeds are moved there first

Errors use `feeds/invalid-request` (bad name/arguments) or `feeds/not-found`.

## `feeds/import`

Payload: `{ path: string; mode?: 'replace' | 'merge' }` (default `replace`). `merge` keeps existing
subscriptions and adds missing ones while refreshing title/site/category for URLs already present;
`replace` swaps the list (existing behavior, read/saved state for matching URLs is kept). Result:
`{ mode, feeds, added, updated, removed, categories, refreshing, stats }`; the Host starts a background
refresh.

## `feeds/mark`

Payload: `{ ids?: string[]; category?: string; feedId?: string; unread?: boolean }` — at least one
target selector. Result: `{ marked: number; unread: number }` where `unread` is the new global count.

## `feeds/refresh`

Payload: `{ feedId?: string }` (omit for all feeds). Waits up to 45 s; after that the refresh keeps
running in the background. Result: a compact snapshot (see above) with `refreshing` possibly `true`.

## `feeds/article`

Payload: `{ itemId: string; force?: boolean }` (`force` bypasses a cached extraction failure).

The Host prefers the RSS full content stored at fetch time (`bodyHtml`); otherwise it fetches the
article page and extracts readable content. Non-http(s) and private/loopback article URLs are
rejected (SSRF guard). Feed summaries that are only a placeholder (for example Hacker News'
`<description>Comments</description>`) are stored as an empty summary; an RSS `<comments>` link is
preserved in `item.comments` so the UI can offer the discussion. Result:

```ts
{
  item: { id, title, link, summary, comments: string, author: string | null, published: number | null, unread: boolean }
  feed: { id, title, category, site: string | null }
  content: string                     // readable text, bounded
  contentKind: 'article' | 'text' | 'summary'   // 'article' covers stored RSS full content
  contentSource: 'feed' | 'web' | 'summary'   // provenance
  contentError: string | null         // e.g. "HTTP 403" when falling back to the summary
  truncated: boolean
  blocks: Array<
    | { type: 'paragraph'; text: string; links?: Array<{ text: string; href: string }> }
    | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
    | { type: 'quote'; text: string }
    | { type: 'list'; ordered: boolean; items: string[] }
    | { type: 'code'; text: string; language?: string }
    | { type: 'table'; rows: string[][] }
    | { type: 'image'; src: string; alt: string; caption: string }
  >
}
```

Image `src` values are absolute `http(s)` URLs on public hosts (private/loopback sources are dropped by the
Host and again by the Client); the Client loads them with `referrerPolicy="no-referrer"`.

## `feeds/remove`

Payload: `{ feedId: string }`. Result: `{ removed: boolean; stats }`.

## Agent tool `feeds`

Registered on the Host for the model; same operations as the RPC surface plus management actions:

`digest` (default), `sources`, `refresh`, `article`, `import`, `add`, `update`, `category`, `mark`,
`article`, `remove`.

| action | parameters |
| --- | --- |
| `import` | `path` (absolute or `~/…`), `mode?` = `replace` \| `merge` |
| `add` | `url` (scheme optional), `title?`, `category?` |
| `update` | `feedId`, `title?`, `category?` (creates the category when new) |
| `category` | `op` = `create` \| `rename` \| `delete`, `name`, `newName?` (rename), `moveTo?` (delete non-empty) |
| `mark` | `itemIds` / `category` / `feedId`, `read` |
| `remove` | `feedId` |
| `digest` | `sinceHours?`, `limit?`, `category?`, `feedId?`, `unreadOnly?` |
| `article` | `itemId` |

- `digest` renders each item with its `id` (pass it to `mark`/`article`); `sources` renders feed ids.
- `add` reports both halves of the outcome: subscription saved, and whether the first fetch succeeded
  (`fetched`, `itemCount`, `error`).
- `update`/`category` accept the same validation as the RPC surface (`feeds/invalid-request` /
  `feeds/not-found`).
- `import` defaults to `replace`; only an absent `mode` defaults, an unknown mode is a client error.
  `merge` adds missing subscriptions and refreshes title/category for existing URLs without removing
  anything.

## Category model

`state.categories` is an ordered explicit list; `categories()` returns that order followed by any feed
categories not listed, so empty categories created through `feeds/category` survive restarts. Renaming merges
on collision; deleting moves feeds to `moveTo` first. OPML `replace` resets the list to the file's categories,
`merge` appends new ones.

## Durability and concurrency

- One `state.json` in `dataDir` (fsync + atomic rename via a unique temp file); mutations are
  serialized and roll back in memory when the write fails.
- A corrupt existing state file is quarantined as `state.json.corrupt-<timestamp>` and the plugin
  starts with an empty store instead of failing every request forever.
- Refresh merges into the latest user state: network-owned fields (items, timestamps, etag, error) come
  from the refresh, while user-owned fields (title, category, url, addedAt) always come from the current
  state, so a category move or rename made during a refresh is never reverted. Only a full refresh with
  at least one successful source advances `lastRefreshAt`; a scoped refresh requested during a full
  refresh runs afterwards rather than joining a target set that predates it.
- When every source fails, the Host backs off (5 minutes) before another automatic refresh; manual
  `feeds/refresh` is never blocked by that backoff.
- Feed, discovered-feed and article URLs pass one gate: syntax/private-literal checks plus DNS
  resolution (private answers rejected) when `allowPrivateHosts` is not enabled.
- `state.json` is bounded: per-item/per-feed body budgets plus a global 25 MiB serialization cap that
  drops the oldest stored bodies.
- The Host declares `inject = ['tools', 'connection']`, so route registration always waits for the
  Host connection during a cold boot. `last-boot.json` records `{ connection, routes }` for diagnosis.
