/**
 * Pure core of the `dsh-feeds` Host half.
 *
 * No DSH imports, no Electron imports: only `node:` builtins and global fetch,
 * so this module can be exercised directly with `node tools/test-core.mjs`.
 *
 * Responsibilities:
 *  - OPML parsing (Feedly export) into a flat, categorized subscription list.
 *  - RSS 2.0 / Atom / RSS 1.0 (RDF) / JSON Feed parsing into normalized items.
 *  - HTTP fetching with conditional GET, charset detection and per-feed errors.
 *  - Durable state (subscriptions, recent items, read markers) in one JSON file.
 *  - Snapshot projection for the Client and for the `feeds` agent tool.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import path from 'node:path';

// A neutral, honest UA. Browser-like UAs get rejected by some feeds
// (Hacker News answers HTTP 419 "Sorry" to a Chrome UA from a non-browser TLS
// stack), while generic reader UAs are accepted by the common feed hosts.
export const UA = 'dsh-feeds/1.0 (RSS reader; +https://deepseek.com)';
export const MAX_ITEMS_PER_FEED = 40;
/** Per-item RSS `content:encoded` storage cap (bytes, approximated by JS length). */
export const BODY_HTML_LIMIT = 64 * 1024;
/** Per-feed budget for stored RSS bodies; older items fall back to web extraction. */
export const FEED_BODY_BUDGET = 2 * 1024 * 1024;
/** Hard cap for one serialized state.json: older stored bodies are dropped to fit. */
export const MAX_STATE_BYTES = 25 * 1024 * 1024;
/** Retry backoff after a full refresh where every source failed. */
export const ALL_FAILED_BACKOFF_MS = 5 * 60_000;
export const SNAPSHOT_ITEM_LIMIT = 800;
export const FETCH_TIMEOUT_MS = 20000;
export const FETCH_CONCURRENCY = 6;
export const UNCATEGORIZED = '未分类';
const STATE_VERSION = 3;

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the XML/HTML entities commonly found in feeds. */
export function decodeEntities(input) {
  if (typeof input !== 'string' || input.indexOf('&') === -1) return input ?? '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const mapped = ENTITY_MAP[body.toLowerCase()];
    return mapped === undefined ? whole : mapped;
  });
}

/**
 * Tolerant, namespace-agnostic XML parser sufficient for feeds and OPML.
 * @returns {{ name: string, attrs: Record<string,string>, children: any[], text: string } | null}
 */
export function parseXml(source) {
  const input = String(source ?? '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\s*(\/?)\s*([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>|([^<]+)/g;
  let match;
  while ((match = tagRe.exec(input)) !== null) {
    if (match[1] !== undefined) {
      stack.at(-1).text += match[1];
      continue;
    }
    if (match[6] !== undefined) {
      const text = decodeEntities(match[6]);
      stack.at(-1).text += text;
      continue;
    }
    if (match[3] === undefined) continue; // comment / declaration / doctype
    const closing = match[2] === '/';
    const rawName = match[3];
    const selfClosing = match[5] === '/';
    const local = rawName.split(':').pop().toLowerCase();
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === local) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    if (match[4] !== undefined && match[4].trim() !== '') {
      const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attr;
      while ((attr = attrRe.exec(match[4])) !== null) {
        const key = attr[1].split(':').pop().toLowerCase();
        attrs[key] = decodeEntities(attr[2] ?? attr[3] ?? '');
      }
    }
    const node = { name: local, attrs, children: [], text: '' };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

/** Serialize a node's descendant elements back into HTML (for Atom xhtml / raw RSS HTML). */
function serializeChildren(node) {
  let out = '';
  for (const child of Array.isArray(node?.children) ? node.children : []) {
    out += `<${child.name}`;
    for (const [key, value] of Object.entries(child.attrs ?? {})) {
      out += ` ${key}="${String(value).replace(/"/g, '&quot;')}"`;
    }
    out += '>';
    out += child.text ?? '';
    out += serializeChildren(child);
    out += `</${child.name}>`;
  }
  return out;
}

const childText = (node, ...names) => {
  if (node === null || node === undefined) return '';
  for (const name of names) {
    for (const child of node.children ?? []) {
      if (child.name === name) {
        const text = (child.text ?? '').trim();
        if (text !== '') return text;
        if (Array.isArray(child.children) && child.children.length > 0) {
          const serialized = serializeChildren(child).trim();
          if (serialized !== '') return serialized;
        }
        const inner = findFirst(child, 'encoded', 'content', 'value', 'summary', 'description');
        if (inner !== null) return (inner.text ?? '').trim();
      }
    }
  }
  return '';
};

const childNode = (node, ...names) => {
  for (const name of names) {
    for (const child of node.children ?? []) if (child.name === name) return child;
  }
  return null;
};

const findFirst = (node, ...names) => {
  if (node === null || node === undefined) return null;
  for (const child of node.children ?? []) {
    if (names.includes(child.name)) return child;
    const nested = findFirst(child, ...names);
    if (nested !== null) return nested;
  }
  return null;
};

const findAll = (node, name, out = []) => {
  for (const child of node.children ?? []) {
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
};

/**
 * Remove one tag's element blocks with a linear indexOf scan. An unclosed block
 * (malicious or truncated markup) consumes the rest of the input instead of
 * making a lazy regex backtrack across the whole document.
 */
function removeTagBlocks(source, tag) {
  const text = String(source ?? '');
  const lower = text.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = '';
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start < 0) {
      out += text.slice(pos);
      break;
    }
    const nextChar = lower[start + open.length];
    if (nextChar !== undefined && nextChar !== '>' && !/\s/.test(nextChar)) {
      out += text.slice(pos, start + open.length);
      pos = start + open.length;
      continue;
    }
    out += text.slice(pos, start);
    const closeIndex = lower.indexOf(close, start + open.length);
    if (closeIndex < 0) break; // unclosed: drop the remainder
    const end = lower.indexOf('>', closeIndex);
    if (end < 0) break;
    pos = end + 1;
  }
  return out;
}

/** Strip tags and scripts from feed HTML into a compact plain-text summary. */
export function stripHtml(input, limit = 500) {
  let text = String(input ?? '');
  if (text === '') return '';
  for (const tag of ['script', 'style', 'noscript']) text = removeTagBlocks(text, tag);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (text.length > limit) text = `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  return text;
}

/** Stable short identifier. */
export function stableId(input) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, 16);
}

const normalizeDate = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
  const text = String(raw).trim();
  if (/^\d{9,13}$/.test(text)) {
    const value = Number(text);
    return value > 1e12 ? value : value * 1000;
  }
  let parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  // Some feeds omit the comma/zone in RFC 822; try a couple of repairs.
  parsed = Date.parse(text.replace(/\s+/g, ' ').replace(/(\d{1,2}:\d{2})(\s)/, '$1$2'));
  return Number.isFinite(parsed) ? parsed : null;
};

const pickLink = (item, baseUrl) => {
  const links = item.children.filter((child) => child.name === 'link');
  // RSS: <link> carries text. Atom: <link rel="alternate" href="..."/>; prefer
  // the alternate link because <link rel="self"> points at the feed itself.
  const ranked = [
    ...links.filter((link) => (link.attrs.rel ?? 'alternate').toLowerCase() === 'alternate'),
    ...links.filter((link) => {
      const rel = (link.attrs.rel ?? '').toLowerCase();
      return rel !== 'self' && rel !== 'enclosure' && rel !== 'alternate';
    }),
  ];
  for (const link of ranked) {
    const href = link.attrs.href;
    if (typeof href === 'string' && href.trim() !== '') return absolutize(href.trim(), baseUrl);
    const text = (link.text ?? '').trim();
    if (text !== '') return absolutize(text, baseUrl);
  }
  return '';
};

/** Resolve a possibly relative URL against the feed URL. */
export function absolutize(url, baseUrl) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  const trimmed = url.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

/** Extract the first advertised RSS/Atom/JSON feed URL from an HTML page. */
export function discoverFeedUrl(html, baseUrl) {
  const source = String(html ?? '');
  if (source === '') return '';
  const tagRe = /<link\b[^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(source)) !== null) {
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attr;
    while ((attr = attrRe.exec(tag[0])) !== null) attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? '');
    const rel = (attrs.rel ?? '').toLowerCase();
    const type = (attrs.type ?? '').toLowerCase();
    const href = (attrs.href ?? '').trim();
    if (href === '' || !rel.split(/\s+/).includes('alternate')) continue;
    if (type.includes('rss') || type.includes('atom') || type.includes('json')) return absolutize(href, baseUrl);
  }
  return '';
}

const looksLikeHtml = (contentType, text) => (contentType ?? '').toLowerCase().includes('html')
  || /^\s*<(!doctype\s+html|html)[\s>]/i.test(String(text ?? '').slice(0, 200));

/** Parse RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed text into normalized items. */
export function parseFeed(text, options = {}) {
  const feedUrl = options.url ?? '';
  const source = String(text ?? '').trim();
  if (source === '') throw new Error('empty response body');
  const jsonFeed = /^\s*[[{]/.test(source) && (options.contentType ?? '').toLowerCase().includes('json')
    ? source
    : (/^\s*\{[\s\S]*"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(source) ? source : null);
  if (jsonFeed !== null) return parseJsonFeed(jsonFeed, feedUrl);

  const doc = parseXml(source);
  const roots = doc.children.filter((child) => child.name !== '#document');
  const rss = roots.find((child) => child.name === 'rss');
  if (rss !== undefined && rss !== null) {
    const channel = childNode(rss, 'channel') ?? rss;
    return {
      format: 'rss',
      title: childText(channel, 'title'),
      site: absolutize(childText(channel, 'link'), feedUrl),
      items: findAll(channel, 'item').map((item) => normalizeRssItem(item, feedUrl)),
    };
  }
  const feed = roots.find((child) => child.name === 'feed');
  if (feed !== undefined && feed !== null) {
    const siteNode = childNode(feed, 'link');
    return {
      format: 'atom',
      title: childText(feed, 'title'),
      site: siteNode === null ? '' : absolutize(pickLink(feed, feedUrl), feedUrl),
      items: findAll(feed, 'entry').map((entry) => normalizeAtomItem(entry, feedUrl)),
    };
  }
  const rdf = roots.find((child) => child.name === 'rdf');
  if (rdf !== undefined && rdf !== null) {
    const channel = childNode(rdf, 'channel');
    return {
      format: 'rdf',
      title: channel === null ? '' : childText(channel, 'title'),
      site: channel === null ? '' : absolutize(childText(channel, 'link'), feedUrl),
      items: findAll(rdf, 'item').map((item) => normalizeRssItem(item, feedUrl)),
    };
  }
  throw new Error('unrecognized feed format');
}

function normalizeRssItem(item, feedUrl) {
  const rawHtml = childText(item, 'encoded', 'description', 'summary', 'content');
  const published = normalizeDate(childText(item, 'pubdate', 'published', 'updated', 'date', 'created'));
  const link = pickLink(item, feedUrl);
  const guid = childText(item, 'guid', 'id', 'about');
  const title = stripHtml(childText(item, 'title'), 300) || '(untitled)';
  return finishItem({ guid, link, title, rawHtml, hasFullContent: !!childText(item, 'encoded', 'content'), published, author: stripHtml(childText(item, 'creator', 'author', 'name'), 120) || null }, feedUrl);
}

function normalizeAtomItem(entry, feedUrl) {
  const rawHtml = childText(entry, 'content', 'summary', 'description');
  const published = normalizeDate(childText(entry, 'published', 'updated', 'date', 'created'));
  const link = pickLink(entry, feedUrl);
  const guid = childText(entry, 'id');
  const title = stripHtml(childText(entry, 'title'), 300) || '(untitled)';
  const authorNode = childNode(entry, 'author');
  const author = authorNode === null ? '' : stripHtml(childText(authorNode, 'name'), 120);
  return finishItem({ guid, link, title, rawHtml, hasFullContent: !!childText(entry, 'content'), published, author: author || null }, feedUrl);
}

function finishItem(partial, feedUrl) {
  const identity = partial.guid || partial.link || `${partial.title}|${partial.published ?? ''}`;
  return {
    id: stableId(feedUrl + '|' + identity),
    guid: partial.guid || '',
    title: partial.title,
    link: partial.link || '',
    summary: stripHtml(partial.rawHtml, 500),
    bodyHtml: partial.hasFullContent ? String(partial.rawHtml).slice(0, BODY_HTML_LIMIT) : undefined,
    author: partial.author ?? null,
    published: partial.published,
  };
}

function parseJsonFeed(source, feedUrl) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid JSON feed: ${error.message}`);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const feedSite = typeof data.home_page_url === 'string' ? data.home_page_url : '';
  return {
    format: 'jsonfeed',
    title: typeof data.title === 'string' ? data.title : '',
    site: absolutize(feedSite, feedUrl),
    items: items.map((item) => {
      if (item === null || typeof item !== 'object') return null;
      const title = stripHtml(typeof item.title === 'string' ? item.title : '', 300) || '(untitled)';
      const link = absolutize(typeof item.url === 'string' ? item.url : (typeof item.external_url === 'string' ? item.external_url : ''), feedUrl);
      const rawHtml = typeof item.content_html === 'string' ? item.content_html : (typeof item.content_text === 'string' ? item.content_text : (typeof item.summary === 'string' ? item.summary : ''));
      const author = item.author !== null && typeof item.author === 'object' && typeof item.author.name === 'string' ? item.author.name : null;
      return finishItem({
        guid: typeof item.id === 'string' ? item.id : '',
        link,
        title,
        rawHtml,
        hasFullContent: !!(item.content_html || item.content_text),
        published: normalizeDate(item.date_published ?? item.date_modified),
        author,
      }, feedUrl);
    }).filter(Boolean),
  };
}

/** Parse a Feedly OPML export into a flat subscription list. */
export function parseOpml(source) {
  const doc = parseXml(String(source ?? ''));
  const body = findFirst(doc, 'body') ?? doc;
  const feeds = [];
  const seen = new Set();
  const walk = (node, category) => {
    for (const outline of node.children ?? []) {
      if (outline.name !== 'outline') {
        walk(outline, category);
        continue;
      }
      const xmlUrl = outline.attrs.xmlurl ?? outline.attrs.url ?? '';
      const title = (outline.attrs.title ?? outline.attrs.text ?? '').trim();
      if (xmlUrl !== '') {
        const url = xmlUrl.trim();
        const dedupeKey = url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        feeds.push({
          url,
          title: title || url,
          site: (outline.attrs.htmlurl ?? '').trim(),
          category: (category ?? '').trim() || UNCATEGORIZED,
        });
        continue;
      }
      const nested = (outline.attrs.title ?? outline.attrs.text ?? '').trim();
      walk(outline, nested || category);
    }
  };
  walk(body, null);
  const head = findFirst(doc, 'head');
  return { title: head === null ? '' : childText(head, 'title'), feeds };
}

/** Decode a fetched body using the HTTP charset, XML declaration, or meta charset. */
/**
 * Extract readable article text from an HTML page. Prefers <article>/<main>,
 * otherwise strips page chrome; returns plain text with paragraph breaks.
 */
const CHROME_CLASS_RE = /(?:^|[\s_-])(?:comments?|commentlist|comment-respond|comment-form|comment-notes|comment-awaiting|respond|reply|share|sharing|related|recommend|subscribe|newsletter|cookie|breadcrumb|pagination|pager|post-meta|entry-meta|post-views|author-box|authorbox|social|advert|advertisement|sponsored|promo|sidebar|widget|nav-links|screen-reader-text|wp-block-post-comments|must-log-in|logged-in-as|says|post-navigation|taxonomy|site-header|site-footer)(?:$|[\s_-])/i;
const NOISE_BLOCK_RE = /^(?:阅读人数|浏览人数|浏览|发表回复|取消回复|您的邮箱地址|显示名称|邮箱|网站|Δ|评论\s*\*?|标签|分享到|上一篇|下一篇|相关文章|相关阅读|点赞|收藏)\s*[:：]?/;
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const BLOCK_OPEN_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'table', 'tr', 'td', 'th', 'dl', 'dt', 'dd']);

/** Parse the attributes of one HTML start tag into a lowercased map. */
function parseHtmlAttrs(raw) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(String(raw ?? ''))) !== null) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** Index just past the matching close tag of the element starting at `start`. */
function findElementEnd(source, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    const selfClosing = /\/\s*>$/.test(match[0]);
    if (match[1] === '/') {
      depth -= 1;
    } else if (!selfClosing) {
      depth += 1;
    }
    if (depth <= 0) return re.lastIndex;
  }
  return -1;
}

/** Remove every element of one tag from `source` (depth aware). */
function removeElementsByTag(source, tag) {
  let out = source;
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const match = new RegExp(`<${tag}\\b`, 'i').exec(out);
    if (match === null) break;
    const end = findElementEnd(out, match.index, tag);
    if (end < 0) break;
    out = `${out.slice(0, match.index)} ${out.slice(end)}`;
  }
  return out;
}

/** Remove elements whose class/id matches the page-chrome pattern. */
function stripChromeElements(source, tag, pattern) {
  let out = source;
  let changed = true;
  let passes = 0;
  while (changed && passes < 4) {
    changed = false;
    passes += 1;
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    const spans = [];
    let match;
    while ((match = openRe.exec(out)) !== null) {
      const value = /(?:class|id)\s*=\s*"([^"]*)"/i.exec(match[0])?.[1] ?? '';
      if (value === '' || !pattern.test(value)) continue;
      const end = findElementEnd(out, match.index, tag);
      if (end < 0) continue;
      spans.push([match.index, end]);
      openRe.lastIndex = end;
    }
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      out = `${out.slice(0, spans[index][0])} ${out.slice(spans[index][1])}`;
      changed = true;
    }
  }
  return out;
}

/** Pick the main content container: a strong class/id candidate, then <article>/<main>. */
function selectArticleContainer(source) {
  const candidates = [];
  const openRe = /<(div|article|section|main)\b[^>]*(?:class|id)\s*=\s*"[^"]*"[^>]*>/gi;
  let match;
  let evaluated = 0;
  while ((match = openRe.exec(source)) !== null && evaluated < 250) {
    const tag = match[1].toLowerCase();
    const value = /(?:class|id)\s*=\s*"([^"]*)"/i.exec(match[0])?.[1] ?? '';
    const strong = /entry-content|post-content|article-content|article-body|post-body|content-body|rich_media_content|markdown-body|main-content|prose|post-entry|single-content/i.test(value);
    const isArticleOrMain = tag === 'article' || tag === 'main';
    if (!strong && !isArticleOrMain) continue;
    const end = findElementEnd(source, match.index, tag);
    if (end < 0) continue;
    const segment = source.slice(match.index, end);
    if (segment.length > 1_800_000) continue;
    evaluated += 1;
    const textLength = segment.replace(/<[^>]+>/g, ' ').length;
    const images = (segment.match(/<img\b/gi) ?? []).length;
    let score = textLength + Math.min(images, 8) * 400;
    if (strong) score += 20000;
    if (CHROME_CLASS_RE.test(value)) score -= 40000;
    candidates.push({ score, segment });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates.length > 0 ? candidates[0].segment : source;
}

/** Resolve one <img> tag to an absolute image URL, or null when it is page furniture. */
function resolveArticleImage(attrs, baseUrl) {
  let src = String(attrs.src ?? '').trim();
  const lazy = String(attrs['data-src'] ?? attrs['data-lazy-src'] ?? attrs['data-original'] ?? attrs['data-url'] ?? '').trim();
  if ((src === '' || src.startsWith('data:') || src.startsWith('about:')) && lazy !== '') src = lazy;
  if (src === '' || src.startsWith('data:')) {
    const srcset = String(attrs.srcset ?? attrs['data-srcset'] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    if (srcset.length > 0) {
      const widthOf = (entry) => Number((/(\d+)w/.exec(entry) ?? [])[1] ?? 0);
      srcset.sort((left, right) => widthOf(right) - widthOf(left));
      src = srcset[0].split(/\s+/)[0];
    }
  }
  if (src === '' || src.startsWith('data:')) return null;
  const width = Number(attrs.width);
  const height = Number(attrs.height);
  if (Number.isFinite(width) && width > 0 && width < 48) return null;
  if (Number.isFinite(height) && height > 0 && height < 48) return null;
  if (/(?:sprite|icon|logo|avatar|emoji|tracker|pixel|spacer|placeholder|gravatar)/i.test(src)) return null;
  if (/\.svg(?:\?|#|$)/i.test(src)) return null;
  const absolute = absolutize(src, baseUrl);
  if (articleUrlBlockedReason(absolute) !== null) return null;
  return { src: absolute, alt: String(attrs.alt ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/** Walk the cleaned article HTML into ordered rich blocks (text, headings, lists, images). */
function articleBlocksFromHtml(html, options) {
  const baseUrl = options.url ?? '';
  const blocks = [];
  const embedded = [];
  let bounded = false;
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (whole, body) => {
    const language = /(?:language-|lang-)([\w+-]+)/i.exec(whole)?.[1] ?? '';
    const text = decodeEntities(body.replace(/<[^>]*>/g, '')).replace(/\r/g, '').replace(/^\n|\n$/g, '');
    embedded.push({ type: 'code', text: text.slice(0, 20000), language, truncated: text.length > 20000 });
    return `<dsh-block data-index="${embedded.length - 1}"></dsh-block>`;
  });
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (whole, body) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => { const value=stripHtml(cell[1],100000); if(value.length>1000)bounded=true; return value.slice(0,1000); }).filter((cell,index)=>{if(index>=12)bounded=true;return index<12;})).filter(row => row.length);
    embedded.push({type:'table', rows:rows.slice(0, 60), header:/<th\b/i.test(body), truncated:rows.length > 60});
    return `<dsh-block data-index="${embedded.length - 1}"></dsh-block>`;
  });
  let buffer = '';
  let links = [];
  let activeLink = null;
  let currentType = 'paragraph';
  let headingLevel = 2;
  const listStack = [];
  const captions = [];
  let lastImage = null;

  const flush = () => {
    const text = decodeEntities(buffer).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    buffer = '';
    const blockLinks = links;
    links = [];
    activeLink = null;
    const rich = blockLinks.length ? { links: blockLinks.slice(0, 50) } : {};
    if (text === '') return;
    if (text.length > (currentType === 'heading' ? 300 : listStack.length ? 2000 : 4000)) bounded=true;
    if (captions.length > 0) {
      const index = captions.length - 1;
      captions[index] = captions[index] === '' ? text : `${captions[index]} ${text}`;
      return;
    }
    if (currentType === 'heading') {
      blocks.push({ type: 'heading', level: Math.min(4, Math.max(1, headingLevel)), text: text.slice(0, 300), ...rich });
      currentType = 'paragraph';
      return;
    }
    if (currentType === 'quote') {
      blocks.push({ type: 'quote', text: text.slice(0, 4000), ...rich });
      currentType = 'paragraph';
      return;
    }
    if (listStack.length > 0) {
      const list = listStack[listStack.length - 1];
      if (list.items.length < 30) list.items.push(text.slice(0, 2000));
      else bounded=true;
      return;
    }
    blocks.push({ type: 'paragraph', text: text.slice(0, 4000), ...rich });
  };

  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([a-zA-Z][\w:-]*)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[0].startsWith('<!--')) continue;
    if (match[1] !== undefined) {
      buffer += ` ${match[1]} `;
      continue;
    }
    if (match[6] !== undefined) {
      buffer += match[6];
      continue;
    }
    const closing = match[2] === '/';
    const name = match[3].toLowerCase();
    const attrs = parseHtmlAttrs(match[4] ?? '');
    const selfClosing = match[5] === '/' || VOID_TAGS.has(name);
    if (name === 'dsh-block') {
      if (!closing) { flush(); const block = embedded[Number(attrs['data-index'])]; if (block) blocks.push(block); }
      continue;
    }
    if (name === 'a') {
      if (closing && activeLink) {
        const label = decodeEntities(buffer.slice(activeLink.start)).replace(/\s+/g, ' ').trim();
        if (label && activeLink.href) links.push({text:label, href:activeLink.href});
        activeLink = null;
      } else if (!closing) {
        const href = absolutize(attrs.href ?? '', baseUrl);
        activeLink = { start: buffer.length, href: /^https?:\/\//i.test(href) ? href : null };
      }
      continue;
    }
    if (name === 'br') {
      buffer += '\n';
      continue;
    }
    if (name === 'img') {
      if (closing || captions.length > 0) continue;
      const image = resolveArticleImage(attrs, baseUrl);
      if (image === null) continue;
      flush();
      const block = { type: 'image', src: image.src, alt: image.alt, caption: '' };
      blocks.push(block);
      lastImage = block;
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      if (closing) {
        flush();
        currentType = 'paragraph';
      } else {
        flush();
        currentType = 'heading';
        headingLevel = Number(name[1]);
      }
      continue;
    }
    if (name === 'blockquote') {
      flush();
      currentType = closing ? 'paragraph' : 'quote';
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      flush();
      if (closing) {
        const list = listStack.pop();
        if (list !== undefined && list.items.length > 0) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
        currentType = 'paragraph';
      } else {
        listStack.push({ ordered: name === 'ol', items: [] });
      }
      continue;
    }
    if (name === 'li') {
      flush();
      currentType = closing ? 'paragraph' : 'li';
      continue;
    }
    if (name === 'figcaption') {
      flush();
      if (closing) {
        const caption = (captions.pop() ?? '').trim();
        if (caption !== '') {
          if (lastImage !== null) lastImage.caption = caption.slice(0, 500);
          else blocks.push({ type: 'paragraph', text: caption.slice(0, 4000) });
        }
      } else {
        captions.push('');
      }
      continue;
    }
    if (name === 'figure') {
      flush();
      continue;
    }
    if (BLOCK_OPEN_TAGS.has(name) || name === 'pre') {
      flush();
      currentType = 'paragraph';
      continue;
    }
    if (name === 'hr') {
      flush();
      continue;
    }
    if (selfClosing) continue;
  }
  flush();
  while (listStack.length > 0) {
    const list = listStack.pop();
    if (list.items.length > 0) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
  }
  if(bounded && blocks.length) blocks[0].truncated=true;
  return blocks;
}

const normalizeTitleText = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

/** Join blocks into the plain-text `content` shape used by tools and fallbacks. */
function articleBlocksToText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'list') parts.push(block.items.map((item) => `- ${item}`).join('\n'));
    else if (block.type === 'image') parts.push(`[图片] ${block.src}${block.alt ? ` (${block.alt})` : ''}`);
    else if (block.type === 'table') parts.push(block.rows.map(row => row.join(' | ')).join('\n'));
    else if (typeof block.text === 'string' && block.text !== '') parts.push(block.text);
  }
  let text = parts.join('\n\n').trim();
  if (text.length > 12000) text = `${text.slice(0, 12000).trimEnd()}…`;
  return text;
}

/**
 * Extract a readable, ordered article: paragraphs/headings/lists/quotes plus images,
 * with navigation, comment forms, share bars and related-post blocks removed.
 * @returns {{ blocks: Array<object>, content: string }}
 */
export function extractArticle(html, options = {}) {
  let source = String(html ?? '');
  if (source.trim() === '') return { blocks: [], content: '' };
  source = source.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'form']) {
    source = removeTagBlocks(source, tag);
  }
  let body = selectArticleContainer(source);
  for (const tag of ['div', 'section', 'aside', 'nav', 'header', 'footer', 'ul', 'ol', 'p']) {
    body = stripChromeElements(body, tag, CHROME_CLASS_RE);
  }
  let blocks = articleBlocksFromHtml(body, options);
  blocks = blocks.filter((block) => {
    if (block.type === 'image') return typeof block.src === 'string' && /^https?:/i.test(block.src);
    if (block.type === 'list') return Array.isArray(block.items) && block.items.length > 0;
    if (block.type === 'table') return block.rows.length > 0;
    const text = String(block.text ?? '').trim();
    if (text === '' || NOISE_BLOCK_RE.test(text)) return false;
    return true;
  });
  const titleKey = normalizeTitleText(options.title ?? '');
  if (titleKey !== '' && blocks.length > 0 && blocks[0].type === 'heading' && normalizeTitleText(blocks[0].text) === titleKey) blocks.shift();
  const truncated = blocks.length > 300 || blocks.some(block => block.truncated) || blocks.reduce((n,block) => n + (block.text?.length ?? 0), 0) > 12000;
  const seenImages = new Set();
  blocks = blocks.filter((block) => {
    if (block.type !== 'image') return true;
    if (seenImages.has(block.src)) return false;
    seenImages.add(block.src);
    return true;
  }).slice(0, 300);
  let content = articleBlocksToText(blocks);
  if (blocks.length === 0) {
    const fallback = plainArticleText(body);
    if (fallback !== '') {
      blocks = [{ type: 'paragraph', text: fallback }];
      content = fallback;
    }
  }
  return { blocks, content, truncated };
}

/** Last-resort plain text (also keeps extractArticleText's historical behavior). */
export function extractArticleText(html) {
  const article = extractArticle(html);
  if (article.content !== '') return article.content;
  let source = String(html ?? '');
  source = source.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  source = source.replace(/<[^>]+>/g, ' ');
  return plainArticleText(source);
}

function plainArticleText(source) {
  const text = decodeEntities(String(source ?? ''))
    .replace(/\r/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n\n');
  if (text.length > 12000) return `${text.slice(0, 12000).trimEnd()}…`;
  return text;
}

export function decodeBuffer(buffer, contentType = '') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase() ?? '';
  if (charset === '') {
    const probe = new TextDecoder('latin1').decode(bytes.slice(0, 600));
    charset = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(probe)?.[1]?.toLowerCase()
      ?? /<meta[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(probe)?.[1]?.toLowerCase()
      ?? 'utf-8';
  }
  if (charset === 'utf8') charset = 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** A request error carrying the RPC error code the Client expects. */
function requestError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Normalize a user-entered feed URL (adds https:// when the scheme is missing). */
export function normalizeFeedUrl(value) {
  let text = String(value ?? '').trim();
  if (text === '') throw requestError('feeds/invalid-request', 'url must not be empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw requestError('feeds/invalid-request', 'invalid feed URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw requestError('feeds/invalid-request', 'feed URL must use http(s)');
  }
  return parsed.toString();
}

/** Stable identity used for duplicate detection (ignores scheme, www, default port, trailing slash). */
export function feedIdentity(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ''));
  } catch {
    return String(value ?? '').trim().toLowerCase();
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const port = parsed.port === '' ? '' : `:${parsed.port}`;
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${host}${port}${pathname}${parsed.search}`;
}

/** Trim and bound a category name. */
export function normalizeCategoryName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (name === '') throw requestError('feeds/invalid-request', 'category name must not be empty');
  if (name.length > 80) throw requestError('feeds/invalid-request', 'category name is too long');
  return name;
}

const now = () => Date.now();

/** Fetch one URL and return `{status, text, contentType, etag, lastModified}`. */
async function fetchFeedText(url, feed, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS, options = {}) {
  const headers = {
    'user-agent': UA,
    accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  };
  if (typeof feed?.etag === 'string' && feed.etag !== '') headers['if-none-match'] = feed.etag;
  if (typeof feed?.lastModified === 'string' && feed.lastModified !== '') headers['if-modified-since'] = feed.lastModified;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const guardRedirects = options.guardRedirects === true;
    let response = null;
    let currentUrl = url;
    let redirects = 0;
    for (;;) {
      response = await fetchImpl(currentUrl, { headers, redirect: guardRedirects ? 'manual' : 'follow', signal: controller.signal });
      if (!guardRedirects) break;
      const finalReason = articleUrlBlockedReason(response.url || currentUrl);
      if (finalReason !== null) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(finalReason);
      }
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        redirects += 1;
        if (redirects > 4) throw new Error('too many redirects');
        if (!location) throw new Error('redirect without location');
        const next = new URL(location, currentUrl).toString();
        const reason = articleUrlBlockedReason(next);
        if (reason !== null) throw new Error(reason);
        currentUrl = next;
        continue;
      }
      break;
    }
    if (response.status === 304) return { status: 304, text: '', contentType: '', etag: feed?.etag, lastModified: feed?.lastModified, finalUrl: response.url || currentUrl };
    const maxBytes = 8 * 1024 * 1024;
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      return {status:response.status,ok:false,text:'',contentType:response.headers.get('content-type') ?? ''};
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error('response too large');
    }
    let buffer;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const {done,value} = await reader.read();
          if(done) break;
          size += value.byteLength;
          if(size > maxBytes) {await reader.cancel();throw new Error('response too large');}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
      buffer = new Uint8Array(size);
      let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
    } else {
      buffer = new Uint8Array(await response.arrayBuffer());
      if(buffer.byteLength > maxBytes) throw new Error('response too large');
    }
    return {
      status: response.status,
      ok: response.ok,
      text: response.ok ? decodeBuffer(buffer, response.headers.get('content-type') ?? '') : '',
      contentType: response.headers.get('content-type') ?? '',
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      size: buffer.byteLength,
      finalUrl: response.url || currentUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Durable feed state + fetch orchestration.
 * One instance per loaded plugin; all mutations flow through it so the Host
 * route handlers, the agent tool and the startup warm-up share one state.
 */
/** Fetch one article URL and return its readable text (falls back to raw text). */
/**
 * Reject article URLs that a feed item should never make the Host fetch:
 * non-HTTP(S) schemes and private/loopback/link-local hosts (basic SSRF guard).
 * Returns a reason string, or null when the URL is acceptable.
 */
export function articleUrlBlockedReason(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return 'invalid article URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'only http(s) article links are fetched';
  let host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '') return 'invalid article URL';
  host = host.replace(/\.+$/, '');
  if (!host.includes('.') && !host.includes(':')) return 'private network article links are not fetched';
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1' || host === '::') {
    return 'private network article links are not fetched';
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return 'private network article links are not fetched';
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return 'private network article links are not fetched';
  const second = /^172\.(\d{1,3})\./.exec(host);
  if (second !== null) {
    const octet = Number(second[1]);
    if (octet >= 16 && octet <= 31) return 'private network article links are not fetched';
  }
  const carrier = /^100\.(\d{1,3})\./.exec(host);
  if (carrier !== null) {
    const octet = Number(carrier[1]);
    if (octet >= 64 && octet <= 127) return 'private network article links are not fetched';
  }
  if (host.startsWith('::ffff:')) return 'private network article links are not fetched';
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return 'private network article links are not fetched';
  return null;
}

/** True for loopback/private/link-local literal IP addresses. */
export function isPrivateAddress(address) {
  const ip = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (!ip.includes(':')) return false;
  if (ip === '::' || ip === '::1') return true;
  if (/^fe[89ab]/.test(ip)) return true;
  if (/^f[cd]/.test(ip)) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped !== null) return isPrivateAddress(mapped[1]);
  return false;
}

export async function fetchArticle(url, fetchImpl = globalThis.fetch, timeoutMs = 12000, options = {}) {
  const blocked = articleUrlBlockedReason(url);
  if (blocked !== null) return { ok: false, error: blocked, blocked: true };
  let result;
  try {
    result = await fetchFeedText(url, {}, fetchImpl, timeoutMs, { guardRedirects: true });
  } catch (error) {
    const message = error?.message ?? String(error);
    if (/private network article links|only http\(s\)|invalid article URL|too many redirects|redirect without location/i.test(message)) {
      return { ok: false, error: message, blocked: true };
    }
    throw error;
  }
  if (result.status === 304) return { ok: false, error: 'HTTP 304' };
  if (!result.ok) return { ok: false, status: result.status, error: `HTTP ${result.status}` };
  const contentType = result.contentType ?? '';
  const head = result.text.slice(0, 5000);
  const looksHtml = /html/i.test(contentType) || /^\s*<(!doctype|<html|<body|<article)/i.test(result.text.slice(0, 200)) || /<article\b|<body\b|<main\b/i.test(head);
  if (!looksHtml) {
    return { ok: true, content: result.text.trim().slice(0, 12000), blocks: [], contentKind: 'text' };
  }
  const article = extractArticle(result.text, { url: options.url ?? url, title: options.title ?? '' });
  return { ok: true, content: article.content, blocks: article.blocks, contentKind: 'article', contentType, truncated: article.truncated };
}

export class FeedService {
  constructor(options = {}) {
    this.dataDir = options.dataDir;
    this.refreshMinutes = Number.isFinite(options.refreshMinutes) && options.refreshMinutes >= 0 ? options.refreshMinutes : 30;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.state = emptyState();
    this.progress = null;
    this.refreshing = null;
    this.loaded = false;
    this._saveChain = Promise.resolve();
    this._itemVersions = new Map();
    this._mutationChain = Promise.resolve();
    this.articleCache = new Map();
    this._articlePending = new Map();
    this.articleTtlMs = 30 * 60_000;
    this.checkDns = options.checkDns === true;
    this.lookup = options.lookup ?? dnsLookup;
    this.nextRefreshAt = 0;
  }

  /**
   * Full URL gate: syntax/private-literal checks plus (when enabled) DNS
   * resolution, so a public hostname that resolves to a private address is
   * rejected too. Returns a reason string or null.
   */
  async urlBlockedReason(url) {
    const syntax = articleUrlBlockedReason(url);
    if (syntax !== null) return syntax;
    if (!this.checkDns) return null;
    let hostname;
    try {
      hostname = new URL(String(url)).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return 'invalid URL';
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return null;
    try {
      const records = await this.lookup(hostname, { all: true, verbatim: true });
      for (const record of Array.isArray(records) ? records : [records]) {
        const address = typeof record === 'string' ? record : record?.address;
        if (isPrivateAddress(address)) return 'private network hosts are not fetched';
      }
    } catch {
      /* resolution failures surface through the fetch itself */
    }
    return null;
  }

  async load() {
    if (this.loaded) return this;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
        if (!parsed || !Array.isArray(parsed.feeds)) throw new Error('invalid feed state');
        this.state = migrateState(parsed);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          // A crash-truncated/corrupt state must not brick the plugin forever:
          // quarantine the file (never delete it) and start with an empty store.
          const quarantine = `${this.stateFile}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
          try { await fs.rename(this.stateFile, quarantine); } catch { /* best effort */ }
          console.warn(`[feeds] state.json could not be read (${error?.message ?? error}); quarantined to ${quarantine} and starting with an empty store`);
          this.state = emptyState();
        }
      }
      this.loaded = true;
      return this;
    })();
    try { return await this._loadPromise; }
    finally { this._loadPromise = null; }
  }

  async save() {
    const serialized = this._serializeBounded();
    const write = this._saveChain.then(async () => {
      await fs.mkdir(this.dataDir, { recursive: true });
      const tmp = `${this.stateFile}.${process.pid}.${Date.now().toString(36)}.tmp`;
      try {
        const handle = await fs.open(tmp, 'w');
        try {
          await handle.writeFile(serialized, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(tmp, this.stateFile);
      } catch (error) {
        await fs.unlink(tmp).catch(() => {});
        throw error;
      }
    });
    this._saveChain = write.catch(() => {});
    return write;
  }

  /** Serialize the state, dropping oldest stored article bodies if the file is too large. */
  _serializeBounded() {
    let serialized = JSON.stringify(this.state);
    if (serialized.length <= MAX_STATE_BYTES) return serialized;
    for (const feed of this.state.feeds) {
      for (let index = feed.items.length - 1; index >= 0; index -= 1) {
        if (!feed.items[index].bodyHtml) continue;
        delete feed.items[index].bodyHtml;
        serialized = JSON.stringify(this.state);
        if (serialized.length <= MAX_STATE_BYTES) return serialized;
      }
    }
    return serialized;
  }

  /** Whether a scheduled refresh is due. */
  isStale() {
    if (now() < this.nextRefreshAt) return false;
    const last = this.state.lastRefreshAt ?? 0;
    return now() - last > this.refreshMinutes * 60_000;
  }

  /** Replace the subscription list with an OPML export, keeping matching items. */
  _mutate(action) {
    const operation = this._mutationChain.then(async () => {
      const before = {...this.state,categories:[...(this.state.categories ?? [])],feeds:this.state.feeds.map(feed=>({...feed,read:{...feed.read},saved:{...feed.saved}}))};
      try {return await action();}
      catch(error){this.state=before;throw error;}
    });
    this._mutationChain = operation.catch(() => {});
    return operation;
  }

  mark(options) { return this._mutate(() => this._mark(options)); }
  saveItems(options) { return this._mutate(() => this._saveItems(options)); }
  removeFeed(feedId) { return this._mutate(() => this._removeFeed(feedId)); }
  addFeed(entry) { return this._mutate(() => this._addFeed(entry)); }
  updateFeed(feedId, changes) { return this._mutate(() => this._updateFeed(feedId, changes)); }
  addCategory(name) { return this._mutate(() => this._addCategory(name)); }
  renameCategory(from, to) { return this._mutate(() => this._renameCategory(from, to)); }
  deleteCategory(name, options) { return this._mutate(() => this._deleteCategory(name, options)); }
  importOpml(filePath, options) { return this._mutate(() => this._importOpml(filePath, options)); }

  /** Add one category to the explicit list (no-op when present). */
  _ensureCategory(name) {
    const category = normalizeCategoryName(name);
    if (!Array.isArray(this.state.categories)) this.state.categories = [];
    if (!this.state.categories.includes(category)) this.state.categories.push(category);
    return category;
  }

  _categoryNames() {
    const names = [];
    for (const name of this.state.categories ?? []) if (!names.includes(name)) names.push(name);
    for (const feed of this.state.feeds) {
      const name = feed.category || UNCATEGORIZED;
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }

  async _importOpml(filePath, options = {}) {
    const mode = options?.mode === 'merge' ? 'merge' : 'replace';
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = parseOpml(source);
    if (!Array.isArray(parsed.feeds) || parsed.feeds.length === 0) {
      throw requestError('feeds/invalid-request', 'OPML contains no subscriptions; the existing subscription list was kept');
    }
    const rawEntries = parsed.feeds.map((entry) => ({ ...entry, url: normalizeFeedUrl(entry.url), category: entry.category || UNCATEGORIZED }));
    const seenIdentities = new Set();
    const entries = rawEntries.filter((entry) => {
      const identity = feedIdentity(entry.url);
      if (seenIdentities.has(identity)) return false;
      seenIdentities.add(identity);
      return true;
    });
    const incomingCategories = [];
    for (const entry of entries) if (!incomingCategories.includes(entry.category)) incomingCategories.push(entry.category);
    let added = 0;
    let updated = 0;
    let removed = 0;
    if (mode === 'merge') {
      const byUrl = new Map(this.state.feeds.map((feed) => [feedIdentity(feed.url), feed]));
      for (const entry of entries) {
        this._ensureCategory(entry.category);
        const existing = byUrl.get(feedIdentity(entry.url));
        if (existing === undefined) {
          const feed = {
            id: stableId(entry.url), url: entry.url,
            title: entry.title || entry.url, site: entry.site || '',
            category: entry.category, addedAt: now(), items: [], read: {}, saved: {},
            fetchedAt: null, everFetched: false, error: null,
          };
          this.state.feeds.push(feed);
          byUrl.set(feedIdentity(entry.url), feed);
          added += 1;
        } else {
          existing.category = entry.category;
          if (!existing.title || existing.title === existing.url || /^https?:\/\//i.test(existing.title)) existing.title = entry.title || existing.title;
          if (!existing.site && entry.site) existing.site = entry.site;
          updated += 1;
        }
      }
    } else {
      const beforeCount = this.state.feeds.length;
      const byUrl = new Map(this.state.feeds.map((feed) => [feedIdentity(feed.url), feed]));
      const feeds = entries.map((entry) => {
        const existing = byUrl.get(feedIdentity(entry.url));
        const id = existing?.id ?? stableId(entry.url);
        return {
          ...(existing ?? {}),
          id,
          url: entry.url,
          title: entry.title,
          site: entry.site || existing?.site || '',
          category: entry.category,
          addedAt: existing?.addedAt ?? now(),
          items: existing?.items ?? [],
          read: existing?.read ?? {},
          saved: existing?.saved ?? {},
          fetchedAt: existing?.fetchedAt ?? null,
          everFetched: existing?.everFetched === true,
          error: existing?.error ?? null,
          etag: existing?.etag,
          lastModified: existing?.lastModified,
        };
      });
      this.state.feeds = feeds;
      this.state.categories = [...new Set(incomingCategories)];
      removed = Math.max(0, beforeCount - feeds.length);
      added = feeds.filter((feed) => byUrl.get(feedIdentity(feed.url)) === undefined).length;
      updated = feeds.length - added;
    }
    this.state.opmlPath = filePath;
    this.state.opmlTitle = parsed.title;
    this.state.importedAt = now();
    this.pruneRead();
    await this.save();
    return {
      mode,
      feeds: this.state.feeds.length,
      added,
      updated,
      removed,
      categories: this._categoryNames(),
      title: parsed.title,
    };
  }

  async _addFeed(entry) {
    const url = normalizeFeedUrl(entry?.url);
    const identity = feedIdentity(url);
    if (this.state.feeds.some((feed) => feedIdentity(feed.url) === identity)) {
      // A duplicate add must not create its target category as a side effect.
      return { added: false, reason: 'already-subscribed' };
    }
    const category = typeof entry?.category === 'string' && entry.category.trim() !== ''
      ? this._ensureCategory(entry.category)
      : UNCATEGORIZED;
    const feed = {
      id: stableId(url), url,
      title: String(entry?.title ?? '').trim() || url,
      site: String(entry?.site ?? '').trim(),
      category,
      addedAt: now(), items: [], read: {}, saved: {}, fetchedAt: null, everFetched: false, error: null,
    };
    this.state.feeds.push(feed);
    if (!Array.isArray(this.state.categories)) this.state.categories = [];
    if (!this.state.categories.includes(category)) this.state.categories.push(category);
    await this.save();
    return { added: true, feedId: feed.id, category };
  }

  async _updateFeed(feedId, changes = {}) {
    const feed = this.state.feeds.find((entry) => entry.id === feedId);
    if (feed === undefined) throw requestError('feeds/not-found', 'feed not found');
    if (Object.hasOwn(changes ?? {}, 'title')) {
      const title = String(changes.title ?? '').trim();
      if (title === '') throw requestError('feeds/invalid-request', 'feed title must not be empty');
      if (title.length > 200) throw requestError('feeds/invalid-request', 'feed title is too long');
      feed.title = title;
    }
    if (Object.hasOwn(changes ?? {}, 'category')) {
      feed.category = this._ensureCategory(changes.category);
    }
    await this.save();
    return { updated: true, feed: { id: feed.id, title: feed.title, category: feed.category } };
  }

  async _addCategory(name) {
    const category = normalizeCategoryName(name);
    if (!Array.isArray(this.state.categories)) this.state.categories = [];
    const exists = this._categoryNames().includes(category);
    if (!this.state.categories.includes(category)) this.state.categories.push(category);
    await this.save();
    return { created: !exists, name: category, categories: this._categoryNames() };
  }

  async _renameCategory(from, to) {
    const source = normalizeCategoryName(from);
    const target = normalizeCategoryName(to);
    if (!this._categoryNames().includes(source)) throw requestError('feeds/not-found', 'category not found');
    if (source === target) return { renamed: false, merged: false, name: target, moved: 0, categories: this._categoryNames() };
    const merged = this._categoryNames().includes(target);
    let moved = 0;
    for (const feed of this.state.feeds) {
      if (feed.category === source) {
        feed.category = target;
        moved += 1;
      }
    }
    if (!Array.isArray(this.state.categories)) this.state.categories = [];
    this.state.categories = this.state.categories.filter((name) => name !== source);
    if (!this.state.categories.includes(target)) this.state.categories.push(target);
    await this.save();
    return { renamed: true, merged, name: target, moved, categories: this._categoryNames() };
  }

  async _deleteCategory(name, options = {}) {
    const category = normalizeCategoryName(name);
    if (!this._categoryNames().includes(category)) throw requestError('feeds/not-found', 'category not found');
    const members = this.state.feeds.filter((feed) => feed.category === category);
    let moveTo = null;
    if (members.length > 0) {
      if (typeof options?.moveTo !== 'string' || options.moveTo.trim() === '') {
        throw requestError('feeds/invalid-request', 'category still has feeds; provide moveTo');
      }
      moveTo = this._ensureCategory(options.moveTo);
      if (moveTo === category) throw requestError('feeds/invalid-request', 'moveTo must differ from the deleted category');
      for (const feed of members) feed.category = moveTo;
    }
    if (!Array.isArray(this.state.categories)) this.state.categories = [];
    this.state.categories = this.state.categories.filter((entry) => entry !== category);
    await this.save();
    return { deleted: true, name: category, moved: members.length, moveTo, categories: this._categoryNames() };
  }

  async _removeFeed(feedId) {
    const target = this.state.feeds.find((feed) => feed.id === feedId);
    const before = this.state.feeds.length;
    this.state.feeds = this.state.feeds.filter((feed) => feed.id !== feedId);
    if (this.state.feeds.length === before) return { removed: false };
    this.pruneRead();
    await this.save();
    return { removed: true, title: target?.title ?? '' };
  }

  /** Mark items read/unread by id, or a whole category/feed. */
  async _mark({ ids, category, feedId, unread }) {
    const read = unread === true ? false : true;
    const targets = [];
    if (Array.isArray(ids) && ids.length > 0) {
      const wanted = new Set(ids.map(String));
      for (const feed of this.state.feeds) for (const item of feed.items) if (wanted.has(item.id)) targets.push([feed, item]);
    } else if (typeof category === 'string' || typeof feedId === 'string') {
      for (const feed of this.state.feeds) {
        if (typeof feedId === 'string' && feed.id !== feedId) continue;
        if (typeof category === 'string' && feed.category !== category) continue;
        for (const item of feed.items) targets.push([feed, item]);
      }
    }
    const previous = targets.map(([feed,item]) => {
      const key = `read:${item.id}`;
      const version = (this._itemVersions.get(key) || 0) + 1;
      this._itemVersions.set(key,version);
      return {feed,id:item.id,value:feed.read[item.id],key,version};
    });
    for (const [feed, item] of targets) {
      if (read) feed.read[item.id] = 1;
      else delete feed.read[item.id];
    }
    this.pruneRead();
    try { await this.save(); }
    catch (error) {
      for (const entry of previous) if(this._itemVersions.get(entry.key) === entry.version) {
        if(entry.value === undefined) delete entry.feed.read[entry.id];
        else entry.feed.read[entry.id] = entry.value;
      }
      throw error;
    }
    return { marked: targets.length };
  }

  async _saveItems({ ids, saved = true }) {
    const wanted = new Set(Array.isArray(ids) ? ids.map(String) : []);
    const previous = [];
    for (const feed of this.state.feeds) {
      feed.saved ??= {};
      for (const item of feed.items) {
        if (!wanted.has(item.id)) continue;
        const key = `saved:${item.id}`;
        const version = (this._itemVersions.get(key) || 0) + 1;
        this._itemVersions.set(key,version);
        previous.push({feed,id:item.id,value:feed.saved[item.id],key,version});
        if (saved) feed.saved[item.id] = 1;
        else delete feed.saved[item.id];
      }
    }
    try { await this.save(); }
    catch(error) {
      for(const entry of previous) if(this._itemVersions.get(entry.key) === entry.version) {
        if(entry.value === undefined) delete entry.feed.saved[entry.id];
        else entry.feed.saved[entry.id] = entry.value;
      }
      throw error;
    }
    return { changed: previous.length };
  }

  pruneRead() {
    for (const feed of this.state.feeds) {
      const alive = new Set(feed.items.map(item => item.id));
      for (const field of ['read', 'saved']) {
        for (const key of Object.keys(feed[field] ?? {})) if (!alive.has(key)) delete feed[field][key];
      }
    }
  }

  /** Coalesce covered requests, queue requests not covered by the active scope. */
  refresh({ feedId } = {}) {
    if (this.refreshing !== null) {
      if (feedId === undefined) {
        if (this._refreshFeedId === undefined) return this.refreshing;
        return this.refreshing.then(() => this.refresh({}));
      }
      if (this._refreshFeedId === feedId) return this.refreshing;
      // A full refresh in flight does not include a just-added feed; run the
      // scoped refresh afterwards instead of reporting a fetch that never ran.
      return this.refreshing.then(() => this.refresh({ feedId }));
    }
    this._refreshFeedId = feedId;
    const run = this._refresh({ feedId }).finally(() => {
      if (this.refreshing === run) this.refreshing = null;
    });
    this.refreshing = run;
    return run;
  }

  async _refresh({ feedId } = {}) {
    const targets = this.state.feeds.filter(feed => feedId === undefined || feed.id === feedId)
      .map(feed => ({...feed,items:feed.items.map(item => ({...item})),read:{...feed.read},saved:{...feed.saved}}));
    if (!targets.length) return {refreshed:0,failed:0};
    this.progress = {done:0,total:targets.length,errors:0,startedAt:now()};
    let cursor = 0, failed = 0;
    const worker = async () => {
      while(cursor < targets.length) {
        const feed = targets[cursor++];
        try {await this.refreshOne(feed);feed.error=null;}
        catch(error) {failed++;feed.error=shorten(error?.message ?? String(error),200);feed.errorAt=now();}
        finally {this.progress.done++;this.progress.errors=failed;}
      }
    };
    try {
      await Promise.all(Array.from({length:Math.min(FETCH_CONCURRENCY,targets.length)},worker));
      await this._mutate(async () => {
        const before = this.state.feeds;
        const lastRefreshAt = this.state.lastRefreshAt;
        const updates = new Map(targets.map(feed => [feed.id,feed]));
        this.state.feeds = before.map(current => {
          const incoming = updates.get(current.id);
          if(!incoming) return current;
          if(incoming.error) return {...current,error:incoming.error,errorAt:incoming.errorAt};
          const read = {...incoming.read};
          for(const item of current.items) {
            if(current.read?.[item.id] === 1) read[item.id]=1;
            else delete read[item.id];
          }
          const saved = {...current.saved};
          const seen = new Set(incoming.items.map(item => item.id));
          const retained = current.items.filter(item => saved[item.id] === 1 && !seen.has(item.id));
          // User-owned fields (title/category/url/addedAt) win over the pre-fetch
          // snapshot; only network-owned fields come from the refresh copy.
          const titleIsPlaceholder = current.title === '' || current.title === current.url || /^https?:\/\//i.test(current.title);
          const title = titleIsPlaceholder && incoming.title ? incoming.title : current.title;
          return {
            ...current,
            title,
            site: current.site || incoming.site || '',
            fetchUrl: incoming.fetchUrl ?? current.fetchUrl,
            fetchedAt: incoming.fetchedAt,
            everFetched: incoming.everFetched,
            error: null,
            errorAt: undefined,
            etag: incoming.etag,
            lastModified: incoming.lastModified,
            read,
            saved,
            items: [...incoming.items, ...retained],
          };
        });
        if(feedId === undefined && failed < targets.length) this.state.lastRefreshAt=now();
        this.pruneRead();
        try {await this.save();}
        catch(error){this.state.feeds=before;this.state.lastRefreshAt=lastRefreshAt;throw error;}
      });
      this.nextRefreshAt = targets.length > 0 && failed === targets.length ? now() + ALL_FAILED_BACKOFF_MS : 0;
      return {refreshed:targets.length,failed};
    } finally {this.progress=null;}
  }

  async refreshOne(feed) {
    const fetchUrl = typeof feed.fetchUrl === 'string' && feed.fetchUrl !== '' ? feed.fetchUrl : feed.url;
    const feedBlocked = await this.urlBlockedReason(fetchUrl);
    if (feedBlocked !== null) throw new Error(feedBlocked);
    let result = await fetchFeedText(fetchUrl, feed, this.fetchImpl);
    if (result.status === 304) {
      feed.fetchedAt = now();
      feed.everFetched = true;
      return;
    }
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    if (result.size !== undefined && result.size > 8 * 1024 * 1024) throw new Error('response too large');
    let parsed;
    try {
      parsed = parseFeed(result.text, { url: result.finalUrl || fetchUrl, contentType: result.contentType });
    } catch (error) {
      // A subscription that now redirects to an HTML page may still advertise a
      // replacement feed; follow that once and remember it for future refreshes.
      if (!looksLikeHtml(result.contentType, result.text)) throw error;
      const discovered = discoverFeedUrl(result.text, fetchUrl);
      if (discovered === '' || discovered === fetchUrl) throw new Error('unrecognized feed format (HTML page without a feed link)');
      const discoveredBlocked = await this.urlBlockedReason(discovered);
      if (discoveredBlocked !== null) throw new Error(discoveredBlocked);
      feed.fetchUrl = discovered;
      feed.etag = undefined;
      feed.lastModified = undefined;
      result = await fetchFeedText(discovered, feed, this.fetchImpl);
      if (!result.ok) throw new Error(`HTTP ${result.status} (discovered feed)`);
      parsed = parseFeed(result.text, { url: discovered, contentType: result.contentType });
    }
    const titlesThisRun = parsed.title;
    if (titlesThisRun !== '') {
      const placeholder = feed.title === '' || feed.title === feed.url || /^https?:\/\//i.test(feed.title);
      if (placeholder) feed.title = titlesThisRun;
    }
    if (feed.site === '' || feed.site === null) feed.site = parsed.site || '';
    const existing = new Map(feed.items.map((item) => [item.id, item]));
    const baseline = feed.everFetched !== true;
    const incoming = [];
    for (const item of parsed.items) {
      const prior = existing.get(item.id);
      if (prior !== undefined) {
        prior.lastSeenAt = now();
        if (item.bodyHtml) prior.bodyHtml = item.bodyHtml;
        prior.title = item.title;
        prior.summary = item.summary;
        continue;
      }
      incoming.push({ ...item, feedId: feed.id, fetchedAt: now() });
      // The first successful fetch establishes the baseline: items already
      // published before the user started using DSH are not "new".
      if (baseline) feed.read[item.id] = 1;
    }
    feed.items = [...incoming, ...feed.items]
      .sort((a, b) => (b.published ?? b.fetchedAt ?? 0) - (a.published ?? a.fetchedAt ?? 0))
      .filter((item, index) => index < MAX_ITEMS_PER_FEED || feed.saved?.[item.id] === 1);
    enforceFeedBodyBudget(feed);
    feed.fetchedAt = now();
    feed.everFetched = true;
    feed.etag = result.etag;
    feed.lastModified = result.lastModified;
    feed.formattedAt = now();
  }

  /** Compact list of categories with per-feed unread counts. */
  categories() {
    const names = this._categoryNames();
    const map = new Map(names.map((name) => [name, { name, unread: 0, feeds: [] }]));
    for (const feed of this.state.feeds) {
      const name = feed.category || UNCATEGORIZED;
      if (!map.has(name)) map.set(name, { name, unread: 0, feeds: [] });
      const entry = map.get(name);
      const unread = countUnread(feed);
      entry.unread += unread;
      entry.feeds.push({
        id: feed.id, title: feed.title, site: feed.site || null, url: feed.url,
        category: name, unread, itemCount: feed.items.length,
        error: feed.error ?? null, lastFetched: feed.fetchedAt ?? null,
      });
    }
    return names.map((name) => map.get(name));
  }

  /** All list metadata, without RSS bodies, ordered by a stable time/id key. */
  _itemRows() {
    const rows = [];
    for (const feed of this.state.feeds) for (const item of feed.items) rows.push({
      id: item.id, feedId: feed.id, feedTitle: feed.title,
      category: feed.category || UNCATEGORIZED,
      title: item.title, link: item.link, summary: item.summary,
      author: item.author ?? null, published: item.published ?? null,
      fetchedAt: item.fetchedAt ?? null, unread: feed.read?.[item.id] !== 1,
      saved: feed.saved?.[item.id] === 1,
    });
    rows.sort((a,b) => itemSortTime(b) - itemSortTime(a) || b.id.localeCompare(a.id));
    return rows;
  }

  queryItems({ category, feedId, query = '', sinceHours, unreadOnly = false, savedOnly = false, limit = 80, cursor } = {}) {
    const needle = String(query).slice(0,500).trim().toLocaleLowerCase();
    const since = Number.isFinite(sinceHours) ? now() - sinceHours * 3_600_000 : null;
    const rows = this._itemRows().filter(item =>
      (typeof category !== 'string' || item.category === category) &&
      (typeof feedId !== 'string' || item.feedId === feedId) &&
      (!unreadOnly || item.unread) && (!savedOnly || item.saved) &&
      (since === null || itemSortTime(item) >= since) &&
      (!needle || `${item.title} ${item.summary} ${item.feedTitle}`.toLocaleLowerCase().includes(needle)));
    let remaining = rows;
    if (cursor) {
      let key;
      try { key = JSON.parse(Buffer.from(String(cursor), 'base64url').toString()); } catch { throw Object.assign(new Error('invalid cursor'), { code: 'invalid-cursor' }); }
      if (!Array.isArray(key) || key.length !== 2 || !Number.isFinite(key[0]) || typeof key[1] !== 'string') throw Object.assign(new Error('invalid cursor'), { code: 'invalid-cursor' });
      remaining = rows.filter(item => itemSortTime(item) < key[0] || (itemSortTime(item) === key[0] && item.id.localeCompare(key[1]) < 0));
    }
    const size = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.floor(limit))) : 80;
    const items = remaining.slice(0, size);
    const last = items.at(-1);
    return { items, total: rows.length, nextCursor: remaining.length > size && last ? Buffer.from(JSON.stringify([itemSortTime(last), last.id])).toString('base64url') : null };
  }

  listItems(options = {}) {
    return this.queryItems({ ...options, limit: options.limit ?? SNAPSHOT_ITEM_LIMIT }).items;
  }

  /**
   * Readable text for one item's reading pane: fetch and extract the article
   * (cached), falling back to the stored summary when the page cannot be read.
   */
  async getArticle(itemId, options = {}) {
    if (this._articlePending.has(itemId)) return this._articlePending.get(itemId);
    const pending = this._loadArticle(itemId, options).finally(() => this._articlePending.delete(itemId));
    this._articlePending.set(itemId,pending);
    return pending;
  }

  async _loadArticle(itemId, { force = false } = {}) {
    const found = this.findItem(itemId);
    if (found === null) return null;
    const { item, feed } = found;
    const cacheKey = item.link || item.id;
    let entry = this.articleCache.get(cacheKey);
    if (force || entry === undefined || Date.now() - entry.at > (entry.kind === 'summary' ? 30000 : this.articleTtlMs)) {
      const fallback = { content: item.summary || '', blocks: [], kind: 'summary', error: null };
      const stored = typeof item.bodyHtml === 'string' && item.bodyHtml ? extractArticle(item.bodyHtml,{url:item.link || feed.url,title:item.title}) : null;
      if (stored?.blocks.length) {
        const article = stored;
        entry = { content:article.content, blocks:article.blocks, kind:'article', source:'feed', truncated:article.truncated, error:null, at:Date.now() };
      } else if (typeof item.link === 'string' && item.link !== '') {
        const webReason = await this.urlBlockedReason(item.link);
        if (webReason !== null) {
          entry = { ...fallback, at: Date.now(), error: webReason };
        } else {
        try {
          const article = await fetchArticle(item.link, this.fetchImpl, 12000, { title: item.title });
          const blocks = Array.isArray(article.blocks) ? article.blocks : [];
          const richEnough = blocks.length > 0 && (blocks.some((block) => block.type === 'image') || (typeof article.content === 'string' && article.content.length >= 40));
          const textEnough = typeof article.content === 'string' && article.content.length >= 120;
          if (article.ok === true && (richEnough || textEnough)) {
            entry = { content: article.content ?? '', blocks, kind: article.contentKind ?? 'article', source:'web', truncated:article.truncated === true, error: null, at: Date.now() };
          } else {
            entry = { ...fallback, at: Date.now(), error: article.error ?? 'content too short' };
          }
        } catch (error) {
          entry = { ...fallback, at: Date.now(), error: error?.message ?? String(error) };
        }
        }
      } else {
        entry = { ...fallback, at: Date.now(), error: null };
      }
      this.articleCache.set(cacheKey, entry);
      if (this.articleCache.size > 80) {
        const oldest = [...this.articleCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest !== undefined) this.articleCache.delete(oldest[0]);
      }
    }
    return {
      item: {
        id: item.id,
        title: item.title,
        link: item.link || '',
        summary: item.summary || '',
        author: item.author ?? null,
        published: item.published ?? null,
        unread: feed.read?.[item.id] !== 1,
        saved: feed.saved?.[item.id] === 1,
      },
      feed: { id: feed.id, title: feed.title, category: feed.category, site: feed.site || null },
      content: entry.content,
      contentKind: entry.kind,
      contentSource: entry.source ?? 'summary',
      truncated: entry.truncated === true,
      contentError: entry.error ?? null,
      blocks: Array.isArray(entry.blocks) ? entry.blocks : [],
    };
  }

  /** Find one stored item and its feed by item id. */
  findItem(itemId) {
    const wanted = String(itemId ?? '');
    if (wanted === '') return null;
    for (const feed of this.state.feeds) {
      for (const item of feed.items) {
        if (item.id === wanted) return { item, feed };
      }
    }
    return null;
  }

  snapshot({includeItems = true} = {}) {
    const categories = this.categories();
    const all = this._itemRows();
    const items = includeItems ? all.slice(0,SNAPSHOT_ITEM_LIMIT) : [];
    const unread = all.reduce((sum, item) => sum + (item.unread ? 1 : 0), 0);
    return {
      generatedAt: now(),
      refreshing: this.refreshing !== null || this.progress !== null,
      progress: this.progress === null ? null : { ...this.progress },
      categories,
      items,
      stats: {
        feeds: this.state.feeds.length,
        items: all.length,
        saved: all.filter(item => item.saved).length,
        unread,
        failed: this.state.feeds.filter((feed) => feed.error !== null && feed.error !== undefined).length,
      },
      opml: { path: this.state.opmlPath ?? null, importedAt: this.state.importedAt ?? null },
      refreshMinutes: this.refreshMinutes,
      lastRefreshAt: this.state.lastRefreshAt ?? null,
    };
  }
}

function emptyState() {
  return {
    version: STATE_VERSION,
    feeds: [],
    categories: [],
    opmlPath: null,
    opmlTitle: '',
    importedAt: null,
    lastRefreshAt: null,
  };
}

function migrateState(parsed) {
  const state = { ...emptyState(), ...parsed, version: STATE_VERSION };
  state.categories = Array.isArray(parsed.categories) ? parsed.categories.map((name) => String(name ?? '').trim()).filter((name) => name !== '') : [];
  state.feeds = (Array.isArray(parsed.feeds) ? parsed.feeds : []).map((feed) => ({
    id: typeof feed.id === 'string' && feed.id !== '' ? feed.id : stableId(feed.url ?? ''),
    url: String(feed.url ?? ''),
    title: String(feed.title ?? feed.url ?? ''),
    site: String(feed.site ?? ''),
    category: String(feed.category ?? '').trim() || UNCATEGORIZED,
    addedAt: feed.addedAt ?? feed.fetchedAt ?? now(),
    items: Array.isArray(feed.items) ? feed.items.filter((item,index) => index < MAX_ITEMS_PER_FEED || feed.saved?.[item.id] === 1) : [],
    saved: feed.saved && typeof feed.saved === 'object' ? feed.saved : {},
    fetchUrl: feed.fetchUrl,
    errorAt: feed.errorAt ?? null,
    read: feed.read !== null && typeof feed.read === 'object' ? feed.read : {},
    fetchedAt: feed.fetchedAt ?? null,
    everFetched: feed.everFetched === true,
    error: feed.error ?? null,
    etag: feed.etag,
    lastModified: feed.lastModified,
  }));
  for (const feed of state.feeds) {
    enforceFeedBodyBudget(feed);
    const category = feed.category || UNCATEGORIZED;
    if (!state.categories.includes(category)) state.categories.push(category);
  }
  return state;
}

/** Bound the stored RSS bodies for one feed so a hostile/large feed cannot bloat state.json. */
function enforceFeedBodyBudget(feed, budget = FEED_BODY_BUDGET) {
  let bytes = 0;
  for (const item of Array.isArray(feed.items) ? feed.items : []) {
    if (typeof item.bodyHtml !== 'string' || item.bodyHtml === '') continue;
    if (item.bodyHtml.length > BODY_HTML_LIMIT) item.bodyHtml = item.bodyHtml.slice(0, BODY_HTML_LIMIT);
    bytes += item.bodyHtml.length;
    if (bytes > budget) delete item.bodyHtml;
  }
}

function countUnread(feed) {
  let unread = 0;
  for (const item of feed.items) if (feed.read?.[item.id] !== 1) unread += 1;
  return unread;
}

function shorten(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Milliseconds since epoch helper used by the Host tool renderer. */
export const clock = { now };

function itemSortTime(item) { return item.published || item.fetchedAt || 0; }
