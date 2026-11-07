# Changelog

## 1.2.1 — 2026-11-07

### Fixed
- **中间列表不再跳动**：点击文章、右侧阅读面板加载/刷新时，不再把文章列表滚动到选中行；
  鼠标点击保持当前滚动位置，并以选中行为锚点抵消阅读面板打开造成的列宽回流。只有键盘
  `j`/`k` 导航时才自动把选中行滚入视野。
- **未读队列自动标读不再重载列表**：在"未读"筛选下打开文章触发的自动已读，不再递增查询
  epoch、重新分页并跳位；行保留在当前列表中，直到下一次显式刷新或切换筛选。

### Changed
- **中间列表视觉精简**：移除行内分类与来源 favicon、来源仅保留低对比文本；常驻的已读按钮
  改为悬停/选中时出现；日分组与同源分组标题改为更轻的小号标签；工具栏计数与"全部已读"
  改为低强调文本；左栏分类默认折叠，减少三栏视觉噪音。

### Tests
- 122 项离线测试（新增列表滚动锚定、键盘 reveal、未读队列自动标读不重载回归测试）。

## 1.2.0 — Subscription and group management (2026-11-07)

- **UI add subscription**: a form in Sources mode (URL, optional title, category select with inline
  "new category"), Enter submit / Escape cancel, URL autofocus, validation, busy lock, and a
  Host-derived result line (fetched N items / saved but first fetch failed / refreshing / already
  subscribed). New categories are created implicitly.
- **Category management**: create, inline rename (merging on name collision), and delete. Deleting a
  non-empty category requires choosing where to move its feeds (default 未分类) with an inline
  confirmation; empty categories are persisted and shown with an empty state.
- **Move sources**: each source row has a category select (plus inline new category) that calls the
  new `update` RPC with optimistic update, per-feed busy state, and revert on failure.
- **OPML import panel**: path input + replace/merge mode (default replace), busy/validation states,
  and an added/updated/removed result line; the copy-command instruction is kept.
- **Host**: explicit ordered category list in state (with migration), `add` / `update` / `category` /
  `import` RPCs, `update` / `category` tool actions, merge-mode OPML import, duplicate detection that
  ignores scheme/www/trailing slash, unsubscribe reports the feed title, and error-code mapping for
  the new mutations.
- **Tests**: 119 offline tests (20 new client management tests plus host/core category, merge-import,
  duplicate, tool-schema, import-vs-refresh and route tests).

## 1.1.3 — Global sidebar entry (2026-11-07)

- Moved the `信息源` entry out of the per-Session Conversation View tabs into the left sidebar's global panel
  list: a new row (`sidebar.panellist` id `feeds`, order 20) sits after **Automation tasks** and before **More**,
  and opens the reader in the central `main` panel (`key: 'feeds'`). The reader is now user-level: it does not
  require or bind a Session, and switching conversations no longer hides it.
- Added a standalone sizing mode for the central panel (fills the panel; composer clearance padding removed),
  a sidebar panel icon, and a localized panel description update.

## 1.1.2 — Release preparation (2026-11-07)

- Added MIT `LICENSE`, `.gitignore`, and GitHub Actions CI (Node 22/24: syntax check + offline tests).
- Renamed the package from a local-only name to `dsh-feeds`; README rewritten for a public preview
  (generic install path, supported formats, security/privacy notes, troubleshooting, roadmap).
- `feeds add` now reports the first fetch outcome instead of unconditionally claiming success:
  success + item count, "saved but first fetch failed: <reason>", or "fetch not finished yet".
- Article SSRF hardening: reject non-`http(s)`, single-label/trailing-dot hosts, private/loopback/
  link-local addresses and IPv4-mapped IPv6; follow redirects manually (max 4) and re-validate every
  hop; the final response URL is checked too.
- State durability: `load()` quarantines a corrupt `state.json` (`state.json.corrupt-<timestamp>`) and
  starts empty instead of bricking the plugin; writes now fsync before the atomic rename and use a
  unique temp name.
- Reliability: a scoped refresh requested during a full refresh no longer reports a fetch that never
  ran; a fully failed refresh no longer advances `lastRefreshAt` (so stale-data retries are not
  suppressed for a whole interval); an invalid pagination cursor is reported as a client request
  error instead of a server outage.
- Bound stored RSS bodies: 64 KiB per item, 2 MiB per feed, so a hostile/large feed cannot bloat
  `state.json`.
- OPML import with an empty/malformed file is rejected instead of wiping the subscription list.
- Host cross-review P1 fixes: failure envelopes now carry `details` (required by the DSH transport
  validator); Atom `content type="xhtml"` and raw-HTML RSS descriptions parse instead of going blank;
  feed/discovered-feed/article URL gating now also resolves DNS and rejects private answers; script/
  style removal is linear (an 8 MiB hostile feed can no longer freeze the Host for minutes); private
  article images are dropped on both sides.
- Host P2 fixes: redirect-aware relative link resolution, 5-minute backoff after a fully failed
  refresh, disposable tool registration, global 25 MiB state serialization cap, image host filtering.
- Second client cross-review fixes: auto-read timer no longer re-arms after an explicit "mark unread"
  and never fires while the tab is hidden; optimistic read/save decisions are overlaid over in-flight
  item queries (and queue views refresh after a toggle); keyboard j/k/m/r and `/` keep working when a
  button has focus (Enter on a row title opens the article); article image failure state resets per
  image; focus mode survives next/previous; a failed "load more" keeps loaded rows; removing a source
  prunes it locally before re-fetching; the help popover is anchored to its button; last-refresh copy
  handles "never"; the article cache uses its constant and promotes on hit.
- Reader state fixes from cross-review: the 2s auto-read timer no longer overrides a manual "mark
  unread"; the 30s metadata poll no longer collapses loaded pages/scroll after a read; "Retry full
  text" force applies only to the retried article; `contentKind: "feed"` is treated as full content;
  a failed filtered query hides stale rows; "Only failed fetches" has an empty state; per-source
  refresh shows a busy state; a truncated snapshot shows the host-unavailable state; the missing
  `markAll.failed` locale key was added.
- Removed personal paths from the manual smoke tool; internal acceptance records moved out of the
  publishable tree.

## 1.1.1 — Reader panel fixes (2026-11-07)

- A−/A+ text sizing (14–28px) in the reading toolbar, persisted; headings/quotes/code/tables scale.
- Reader children use `border-box`; long titles/links wrap; code and tables keep their own horizontal
  scrolling instead of clipping.
- Clicking a source shows all its articles (clearing stale unread/saved filters); restored filters are
  reconciled against source/category conflicts.
- Current filters and a clear action are visible; empty lists distinguish no-unread / no-saved /
  no-cache / fetch-failure and offer to show all source articles; failed requests show retry instead
  of claiming no matching content.
- Health banner limited to the relevant source; redundant Mark0 hidden on empty lists.

## 1.1.0 — Reader upgrade (2026-11-07)

- Host-side filtering/search over the full cache; 80-item first page with stable cursor pagination,
  global totals no longer capped by an 800-item snapshot.
- Source-grouped summaries (expand above 3), time-order option, source icons loaded lazily without
  Referer, local text fallback (no third-party icon service).
- Three independently scrolling panes (sources / articles / reading), responsive two-column or
  overlay reading page.
- Reader text 17px default (15/17/19/21), summary/compact density, read marking after 2s dwell
  (configurable), saved-for-later, previous/next article, restored selection and scroll position.
- RSS full content preferred (available after refresh), preserving code indentation, safe links,
  tables and images; web extraction falls back to summary with retry. Bounded output is labeled.
- Conversation hand-off inserts a prompt referencing `itemId` and requires `feeds.article` first;
  never auto-sends and never triggers a paid model call by itself.
- Background refresh keeps following; pauses while hidden and resumes when visible; stale responses
  cannot overwrite newer filters or read state; failed disk writes report and roll back; mutations
  are serialized and refresh merges into the latest user state.
- Single-flight first load, atomic writes, deduped bounded article cache, 8 MiB download limits.

## 1.0.0 — Initial release

- Feedly/RSS subscriptions in DSH: OPML import, RSS 2.0 / Atom / RDF / JSON Feed parsing,
  reading view with images and article extraction, unread/saved state, source management,
  agent tool (`feeds`), cold-boot route hardening.
