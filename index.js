/**
 * dsh-feeds — Host half.
 *
 * Owns the durable feed store, registers the `feeds` agent tool, and serves the
 * Client view through package-scoped `/api/feeds/*` routes on the Host connection.
 * The implementation logic lives in `feeds-core.js` so it can be tested without DSH.
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { FeedService, UNCATEGORIZED } from './feeds-core.js';

/**
 * Hard dependencies. `connection` is essential: it owns the `/api/feeds/*` fetch
 * routes the Client calls. Declaring it (instead of only `ctx.get('connection')`)
 * makes Cordis wait for the Host connection during a cold boot; otherwise the
 * bundle could activate before that service exists and silently register no
 * routes, leaving the Client view with "Feeds are unavailable" after a restart.
 */
export const inject = ['tools', 'connection'];

const MAX_REFRESH_WAIT_MS = 45_000;
const DEFAULT_LIMIT = 60;

/** Resolve the durable data directory: plugin config first, then DSH home. */
function resolveDataDir(config) {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim() !== '') return config.dataDir;
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'feeds');
}


/** Expand `~/` and require an absolute OPML path; file errors become client errors. */
function resolveOpmlPath(value) {
  let text = String(value ?? '').trim();
  if (text === '') throw Object.assign(new Error('import requires an OPML path'), { code: 'feeds/invalid-request' });
  if (text === '~') text = os.homedir();
  else if (text.startsWith('~/')) text = path.join(os.homedir(), text.slice(2));
  if (!path.isAbsolute(text)) throw Object.assign(new Error('OPML path must be absolute or start with ~/'), { code: 'feeds/invalid-request' });
  return text;
}

/** Validate an import mode; only an absent value defaults to replace. */
function normalizeImportMode(value) {
  if (value === undefined || value === null || value === '') return 'replace';
  if (value === 'replace' || value === 'merge') return value;
  throw Object.assign(new Error('mode must be "replace" or "merge"'), { code: 'feeds/invalid-request' });
}

/** Kick a refresh after any refresh that is already running. */
function refreshAfterCurrent(service) {
  return (service.refreshing ?? Promise.resolve()).catch(() => {}).then(() => service.refresh());
}

/** Run a promise but resolve `{pending:true, promise}` when the budget expires. */
function bounded(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ expired: true }), ms); });
  return Promise.race([promise.then((value) => ({ value })), timeout]).finally(() => clearTimeout(timer));
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '未知时间';
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ms).toISOString();
  }
}

function digestText(value) {
  if (!value || !Array.isArray(value.items)) return '没有可用的订阅内容。';
  if (value.items.length === 0) return '这个时间范围内没有新条目。';
  const lines = [];
  for (const item of value.items) {
    lines.push(`${formatTime(item.published ?? item.fetchedAt)}  ${item.title}`);
    lines.push(`  ${item.feedTitle}${item.category ? ` · ${item.category}` : ''}${item.unread ? ' · 未读' : ''} · id ${item.id}`);
    if (item.link) lines.push(`  ${item.link}`);
    if (item.summary) lines.push(`  ${item.summary.slice(0, 180)}`);
    lines.push('');
  }
  if (value.stats) lines.push(`共 ${value.items.length} 条 · 未读 ${value.stats.unread} · 订阅源 ${value.stats.feeds} · 失败 ${value.stats.failed}`);
  lines.push('（需要标记已读/未读时，把上面的 id 传给 feeds 工具的 mark 动作。）');
  return lines.join('\n').trimEnd();
}

function sourcesText(value) {
  if (!value || !Array.isArray(value.categories)) return '还没有订阅源。';
  const lines = [`订阅源 ${value.stats?.feeds ?? 0} 个 · 未读 ${value.stats?.unread ?? 0} · 失败 ${value.stats?.failed ?? 0}`];
  if (value.opml?.path) lines.push(`OPML：${value.opml.path}`);
  for (const category of value.categories) {
    lines.push('', `【${category.name}】${category.feeds.length} 个源 · 未读 ${category.unread}`);
    for (const feed of category.feeds) {
      const state = feed.error ? `失败：${feed.error}` : `未读 ${feed.unread}/${feed.itemCount}`;
      lines.push(`  - ${feed.title} — ${state} — id ${feed.id} — ${feed.url}`);
    }
  }
  return lines.join('\n');
}

/** Build the tool definition expected by `ctx.tools.register`. */
function buildTool(service, ctx) {
  return {
    name: 'feeds',
    description: 'Read the user’s RSS/Feedly subscriptions (信息源). Use action "digest" for the latest articles across subscriptions (optional category/feedId/sinceHours/limit/unreadOnly), "sources" to list subscriptions with unread counts and fetch errors, "refresh" to fetch the feeds now, "import" to import a Feedly OPML file by absolute path, "add" to subscribe a feed URL, "update" to rename a feed or move it to another category, "category" to create/rename/delete categories (pass name/newName; delete needs moveTo when non-empty), "mark" to set read/unread, "article" to read one item in full, "remove" to unsubscribe. Prefer this tool over web search when the user asks what is new in their feeds.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['digest', 'sources', 'refresh', 'import', 'add', 'update', 'category', 'mark', 'article', 'remove'],
          description: 'Operation to perform. Use "digest" for the latest articles.',
        },
        category: { type: 'string', description: 'Only items/feeds in this subscription category.' },
        feedId: { type: 'string', description: 'Only items/feeds of this feed id.' },
        sinceHours: { type: 'number', description: 'digest: only items published in the last N hours. Default 24.' },
        limit: { type: 'number', description: 'digest: maximum number of items (default 60, max 200).' },
        unreadOnly: { type: 'boolean', description: 'digest: only unread items.' },
        path: { type: 'string', description: 'import: absolute path to an OPML file exported from Feedly.' },
        url: { type: 'string', description: 'add: feed or site URL to subscribe.' },
        mode: { type: 'string', enum: ['replace', 'merge'], description: 'import: replace the whole list (default) or merge into it.' },
        name: { type: 'string', description: 'category: category name for create/rename/delete (rename/delete: the current name).' },
        newName: { type: 'string', description: 'category rename: the new category name.' },
        moveTo: { type: 'string', description: 'category delete: move its feeds to this category (required when it has feeds).' },
        title: { type: 'string', description: 'add: display title for the new feed.' },
        itemIds: { type: 'array', items: { type: 'string' }, description: 'mark: item ids to mark.' },
        itemId: { type: 'string', description: 'article: the item id printed by digest, to read its full text.' },
        read: { type: 'boolean', description: 'mark: true marks read, false marks unread. Default true.' },
        op: { type: 'string', enum: ['create', 'rename', 'delete'], description: 'category: the group operation to perform.' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render: (args, value) => {
        const action = args?.action ?? 'digest';
        if (action === 'sources') return [{ type: 'text', text: sourcesText(value) }];
        if (action === 'digest') return [{ type: 'text', text: digestText(value) }];
        if (action === 'refresh') {
          if (value?.refreshing) return [{ type: 'text', text: `抓取仍在后台进行（${value.progress?.done ?? 0}/${value.progress?.total ?? 0}），稍后用 sources 查看结果。` }];
          return [{ type: 'text', text: `刷新完成：${value?.refreshed ?? 0} 个源，失败 ${value?.failed ?? 0} 个。${value?.stats ? `当前订阅 ${value.stats.feeds} 个源，未读 ${value.stats.unread} 条。` : ''}` }];
        }
        if (action === 'import') return [{ type: 'text', text: `已导入（${value?.mode === 'merge' ? '合并' : '替换'}模式）：${value?.feeds ?? 0} 个订阅源${value?.title ? `（${value.title}）` : ''}；新增 ${value?.added ?? 0}、更新 ${value?.updated ?? 0}、移除 ${value?.removed ?? 0}。${value?.refreshing ? '抓取已在后台开始，稍后用 sources 或 digest 查看。' : ''}` }];
        if (action === 'update') return [{ type: 'text', text: `已更新订阅：${value?.feed?.title ?? ''}${value?.feed?.category ? `（分类：${value.feed.category}）` : ''}。` }];
        if (action === 'category') {
          const op = args?.op ?? 'create';
          if (op === 'create') return [{ type: 'text', text: value?.created ? `已新建分类：${value.name}` : `分类已存在：${value?.name ?? args?.name}` }];
          if (op === 'rename') return [{ type: 'text', text: value?.renamed ? `已重命名分类 → ${value.name}${value.merged ? '（与原分类合并）' : ''}，移动 ${value.moved ?? 0} 个源。` : '分类名称未变化。' }];
          if ((value?.moved ?? 0) > 0) return [{ type: 'text', text: `已删除分类 ${value?.name ?? ''}，${value.moved} 个源已移动到 ${value?.moveTo ?? '未分类'}。` }];
          return [{ type: 'text', text: `已删除分类 ${value?.name ?? ''}。` }];
        }
        if (action === 'article') {
          if (!value || typeof value.content !== 'string') return [{ type: 'text', text: '没有可用的正文内容。' }];
          const head = [value.item?.title ?? '', `${value.feed?.title ?? ''}${value.feed?.category ? ` · ${value.feed.category}` : ''}`, value.item?.link ?? ''].filter((line) => line !== '');
          const note = value.contentError ? `\n\n（正文抓取失败：${value.contentError}，以下为订阅源摘要）` : '';
          return [{ type: 'text', text: `${head.join('\n')}\n\n${value.content}${note}` }];
        }
        if (action === 'mark') return [{ type: 'text', text: (value?.marked ?? 0) === 0 ? '没有找到匹配的条目，请把 digest 结果里的 id 原样传给 mark。' : `已更新 ${value.marked} 个条目的已读状态。` }];
        if (action === 'add') {
          if (value?.added !== true) return [{ type: 'text', text: '该订阅已存在。' }];
          const url = args?.url ?? '';
          if (value.refreshing === true) return [{ type: 'text', text: `已订阅：${url}，首次抓取仍在进行，稍后可用 refresh/sources 查看结果。` }];
          if (value.fetched === true) return [{ type: 'text', text: `已订阅并抓取成功：${url}（本次 ${value.itemCount ?? 0} 条）。` }];
          if (value.error === null || value.error === undefined) {
            return [{ type: 'text', text: `已订阅：${url}，首次抓取尚未完成，稍后可在「订阅源」面板点「刷新」重试。` }];
          }
          return [{ type: 'text', text: `订阅已保存，但首次抓取失败：${value.error}。可稍后在「订阅源」面板点「刷新」重试。` }];
        }
        if (action === 'remove') return [{ type: 'text', text: value?.removed ? `已取消订阅${value.title ? `：${value.title}` : ''}。` : '没有找到该订阅。' }];
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
      },
    },
    timeoutMs: 120_000,
    async execute(args) {
      await service.load();
      const action = typeof args?.action === 'string' ? args.action : 'digest';
      const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(200, Math.floor(args.limit))) : DEFAULT_LIMIT;
      switch (action) {
        case 'sources': {
          const snapshot = service.snapshot();
          return { categories: snapshot.categories, stats: snapshot.stats, opml: snapshot.opml, lastRefreshAt: snapshot.lastRefreshAt };
        }
        case 'digest': {
          if (service.state.feeds.length > 0 && service.isStale() && service.refreshing === null) {
            void service.refresh().catch(() => {});
          }
          const sinceHours = Number.isFinite(args?.sinceHours) ? Math.max(0, args.sinceHours) : 24;
          const items = service.listItems({
            category: typeof args?.category === 'string' ? args.category : undefined,
            feedId: typeof args?.feedId === 'string' ? args.feedId : undefined,
            sinceHours,
            limit,
            unreadOnly: args?.unreadOnly === true,
          });
          const snapshot = service.snapshot();
          return { items, stats: snapshot.stats, sinceHours, refreshing: snapshot.refreshing };
        }
        case 'refresh': {
          const waited = await bounded(service.refresh({ feedId: typeof args?.feedId === 'string' ? args.feedId : undefined }), MAX_REFRESH_WAIT_MS);
          const snapshot = service.snapshot();
          if (waited.expired) return { refreshing: true, progress: snapshot.progress, stats: snapshot.stats };
          return { refreshed: waited.value?.refreshed ?? 0, failed: waited.value?.failed ?? 0, stats: snapshot.stats, progress: snapshot.progress };
        }
        case 'import': {
          const filePath = resolveOpmlPath(args?.path);
          const mode = normalizeImportMode(args?.mode);
          const imported = await service.importOpml(filePath, { mode });
          const waited = await bounded(refreshAfterCurrent(service), MAX_REFRESH_WAIT_MS);
          const snapshot = service.snapshot();
          return {
            ...imported,
            refreshing: waited.expired === true,
            progress: snapshot.progress,
            stats: snapshot.stats,
          };
        }
        case 'update': {
          if (typeof args?.feedId !== 'string' || args.feedId === '') throw new Error('update requires feedId');
          return service.updateFeed(args.feedId, {
            ...(typeof args?.title === 'string' ? { title: args.title } : {}),
            ...(typeof args?.category === 'string' ? { category: args.category } : {}),
          });
        }
        case 'category': {
          const op = typeof args?.op === 'string' ? args.op : 'create';
          if (op === 'create') return service.addCategory(args?.name);
          if (op === 'rename') return service.renameCategory(args?.name, args?.newName);
          if (op === 'delete') return service.deleteCategory(args?.name, { moveTo: args?.moveTo });
          throw new Error(`unknown category op "${op}"`);
        }
        case 'add': {
          if (typeof args?.url !== 'string' || args.url.trim() === '') throw new Error('add requires a url');
          const added = await service.addFeed({ url: args.url, title: args.title, category: args.category });
          if (added.added !== true) return added;
          const waited = await bounded(service.refresh({ feedId: added.feedId }), MAX_REFRESH_WAIT_MS);
          const feed = service.state.feeds.find((entry) => entry.id === added.feedId);
          const fetched = feed !== undefined && feed.fetchedAt !== null && feed.fetchedAt !== undefined && !feed.error;
          return {
            ...added,
            refreshing: waited.expired === true,
            fetched,
            itemCount: Array.isArray(feed?.items) ? feed.items.length : 0,
            error: feed?.error ?? null,
          };
        }
        case 'article': {
          const itemId = typeof args?.itemId === 'string' ? args.itemId.trim() : '';
          if (itemId === '') throw new Error('article requires itemId (the id printed by digest)');
          const article = await service.getArticle(itemId);
          if (article === null) throw new Error(`没有找到条目：${itemId}`);
          return article;
        }
        case 'mark': {
          const result = await service.mark({
            ids: Array.isArray(args?.itemIds) ? args.itemIds.map(String) : undefined,
            category: typeof args?.category === 'string' ? args.category : undefined,
            feedId: typeof args?.feedId === 'string' ? args.feedId : undefined,
            unread: args?.read === false,
          });
          return { ...result, stats: service.snapshot().stats };
        }
        case 'remove': {
          if (typeof args?.feedId !== 'string' || args.feedId === '') throw new Error('remove requires feedId');
          return service.removeFeed(args.feedId);
        }
        default:
          throw new Error(`unknown action "${action}"`);
      }
    },
  };
}

/** JSON envelope used by the package's Client RPC routes. */
function respond(request, status, payload) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } });
}

const failure = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const success = (value) => ({ ok: true, value });

export function apply(ctx, config = {}) {
  const service = new FeedService({
    dataDir: resolveDataDir(config),
    refreshMinutes: Number(config?.refreshMinutes),
    // SSRF default: resolve feed/article hostnames and reject private answers.
    // `allowPrivateHosts: true` opts back in for intentional intranet feeds.
    checkDns: config?.allowPrivateHosts !== true,
  });

  // Expose the store to the agent; registration is an effect so a plugin
  // reload/replacement cannot leave a stale duplicate tool behind.
  ctx.effect(() => ctx.tools.register(buildTool(service, ctx)), 'feeds: tool');

  /** Best-effort boot diagnostic so a cold-start routing problem is visible later. */
  const writeBootLog = (info) => {
    try {
      void fs.mkdir(service.dataDir, { recursive: true })
        .then(() => fs.writeFile(path.join(service.dataDir, 'last-boot.json'), JSON.stringify({ at: new Date().toISOString(), ...info }), 'utf8'))
        .catch(() => {});
    } catch {
      /* diagnostics must never break activation */
    }
  };

  // Package-scoped Client RPC routes: POST /api/feeds/{snapshot,refresh,mark,article,remove}.
  const register = () => {
    const connection = ctx.connection ?? ctx.get('connection');
    if (connection === undefined || connection === null) {
      writeBootLog({ connection: false, routes: 0, reason: 'no-connection-service' });
      return () => {};
    }
    const routes = connection.fetch;
    if (routes === undefined || routes === null || typeof routes.register !== 'function') {
      writeBootLog({ connection: true, routes: 0, reason: 'no-fetch-registry' });
      return () => {};
    }
    const disposers = [];
    const handler = (endpoint) => async (request) => {
      let message;
      try {
        message = await request.json();
      } catch {
        return respond(request, 400, { type: 'server-response', rpcId: 'invalid-request', result: failure('feeds/invalid-request', 'body is not JSON') });
      }
      const valid = message?.type === 'client-request' && typeof message.rpcId === 'string' && message.rpcId !== '';
      if (!valid) return respond(request, 400, { type: 'server-response', rpcId: 'invalid-request', result: failure('feeds/invalid-request', 'invalid client-request message') });
      let result;
      try {
        await service.load();
        const payload = message.payload ?? {};
        if (endpoint === 'snapshot') {
          if (service.state.feeds.length > 0 && service.isStale() && service.refreshing === null) void service.refresh().catch(() => {});
          result = success(service.snapshot({includeItems:payload.compact !== true}));
        } else if (endpoint === 'items') {
          result = success(service.queryItems({
            category:typeof payload.category === 'string' ? payload.category : undefined,
            feedId:typeof payload.feedId === 'string' ? payload.feedId : undefined,
            query:typeof payload.query === 'string' ? payload.query : '',
            unreadOnly:payload.unreadOnly === true, savedOnly:payload.savedOnly === true,
            limit:Number.isFinite(payload.limit) ? Math.min(200,Math.max(1,payload.limit)) : 80,
            cursor:typeof payload.cursor === 'string' ? payload.cursor : undefined,
          }));
        } else if (endpoint === 'save') {
          if(!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 2000) {
            result = failure('feeds/invalid-request','save needs 1–2000 item ids');
          } else {
            result = success(await service.saveItems({ids:payload.ids,saved:payload.saved !== false}));
          }
        } else if (endpoint === 'refresh') {
          const waited = await bounded(service.refresh({ feedId: typeof payload.feedId === 'string' ? payload.feedId : undefined }), MAX_REFRESH_WAIT_MS);
          result = success(service.snapshot({includeItems:false}));
          if (waited.expired) result.value.refreshing = true;
        } else if (endpoint === 'mark') {
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : undefined;
          const category = typeof payload.category === 'string' ? payload.category : undefined;
          const feedId = typeof payload.feedId === 'string' ? payload.feedId : undefined;
          if (ids === undefined && category === undefined && feedId === undefined) {
            result = failure('feeds/invalid-request', 'mark needs ids, category, or feedId');
          } else {
            const marked = await service.mark({ ids, category, feedId, unread: payload.unread === true });
            result = success({ ...marked, unread: service.snapshot().stats.unread });
          }
        } else if (endpoint === 'article') {
          const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
          const article = await service.getArticle(itemId,{force:payload.force === true});
          result = article === null ? failure('feeds/not-found', 'item not found') : success(article);
        } else if (endpoint === 'add') {
          const added = await service.addFeed({ url: payload.url, title: payload.title, category: payload.category });
          if (added.added !== true) {
            result = success({ ...added, refreshing: false, fetched: false, itemCount: 0, error: null });
          } else {
            const waited = await bounded(service.refresh({ feedId: added.feedId }), MAX_REFRESH_WAIT_MS);
            const feed = service.state.feeds.find((entry) => entry.id === added.feedId);
            result = success({
              ...added,
              refreshing: waited.expired === true,
              fetched: feed !== undefined && feed.fetchedAt !== null && feed.fetchedAt !== undefined && !feed.error,
              itemCount: Array.isArray(feed?.items) ? feed.items.length : 0,
              error: feed?.error ?? null,
            });
          }
        } else if (endpoint === 'update') {
          const feedId = typeof payload.feedId === 'string' ? payload.feedId : '';
          if (feedId === '') {
            result = failure('feeds/invalid-request', 'update needs feedId');
          } else {
            result = success(await service.updateFeed(feedId, {
              ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
              ...(typeof payload.category === 'string' ? { category: payload.category } : {}),
            }));
          }
        } else if (endpoint === 'category') {
          const op = typeof payload.op === 'string' ? payload.op : 'create';
          if (op === 'create') result = success(await service.addCategory(payload.name));
          else if (op === 'rename') result = success(await service.renameCategory(payload.name, payload.newName));
          else if (op === 'delete') result = success(await service.deleteCategory(payload.name, { moveTo: payload.moveTo }));
          else result = failure('feeds/invalid-request', `unknown category op ${op}`);
        } else if (endpoint === 'import') {
          const filePath = resolveOpmlPath(payload.path);
          const mode = normalizeImportMode(payload.mode);
          const imported = await service.importOpml(filePath, { mode });
          void refreshAfterCurrent(service).catch(() => {});
          result = success({ ...imported, refreshing: true, stats: service.snapshot().stats });
        } else if (endpoint === 'remove') {
          const feedId = typeof payload.feedId === 'string' ? payload.feedId : '';
          if (feedId === '') {
            result = failure('feeds/invalid-request', 'remove needs feedId');
          } else {
            const removed = await service.removeFeed(feedId);
            result = success({ ...removed, stats: service.snapshot().stats });
          }
        } else {
          result = failure('feeds/unknown-endpoint', `unknown endpoint ${endpoint}`);
        }
      } catch (error) {
        const fileErrors = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EINVAL']);
        const code = typeof error?.code === 'string' && error.code.startsWith('feeds/')
          ? error.code
          : error?.code === 'invalid-cursor' || fileErrors.has(error?.code) ? 'feeds/invalid-request' : 'feeds/unavailable';
        result = failure(code, error?.message ?? String(error));
      }
      return respond(request, 200, { type: 'server-response', rpcId: message.rpcId, result });
    };
    for (const endpoint of ['snapshot', 'items', 'save', 'refresh', 'mark', 'article', 'remove', 'add', 'update', 'category', 'import']) {
      disposers.push(routes.register({ path: `/api/feeds/${endpoint}`, methods: ['POST'], requestBody: 'buffered', fetch: handler(endpoint) }));
    }
    writeBootLog({ connection: true, routes: disposers.length });
    return () => {
      for (const dispose of disposers) {
        try {
          void dispose();
        } catch {
          /* route already gone */
        }
      }
    };
  };

  ctx.effect(register, 'feeds: Client RPC routes');

  // Warm the store on load and keep it fresh while the Host runs.
  ctx.effect(() => {
    let disposed = false;
    const timer = setTimeout(() => {
      if (disposed) return;
      void (async () => {
        try {
          await service.load();
          if (service.state.feeds.length > 0 && service.isStale()) await service.refresh();
        } catch (error) {
          console.warn('[feeds] initial refresh failed:', error?.message ?? error);
        }
      })();
    }, 2_500);
    const period = Math.max(5, Number.isFinite(service.refreshMinutes) ? service.refreshMinutes : 30) * 60_000;
    const interval = setInterval(() => {
      if (disposed || service.refreshing !== null || !service.isStale()) return;
      void service.refresh().catch(() => {});
    }, period);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, 'feeds: refresh schedule');
}

export { UNCATEGORIZED };
