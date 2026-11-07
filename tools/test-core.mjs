/**
 * Standalone smoke test for feeds-core.js (no DSH runtime involved).
 *
 *   node tools/test-core.mjs [opmlPath] [--fetch N] [--all]
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FeedService, parseOpml, parseFeed, decodeBuffer, stripHtml } from '../feeds-core.js';

const args = process.argv.slice(2);
const opmlArg = args.find((arg) => !arg.startsWith('--'));
if (opmlArg === undefined) {
  console.error('usage: node tools/test-core.mjs <path-to-subscriptions.opml> [--fetch N] [--all]');
  process.exit(2);
}
const opmlPath = opmlArg;
const fetchIndex = args.indexOf('--fetch');
const fetchCount = fetchIndex === -1 ? 8 : Number(args[fetchIndex + 1] ?? 8);
const fetchAll = args.includes('--all');

const opml = await fs.readFile(opmlPath, 'utf8');
const parsed = parseOpml(opml);
console.log(`OPML title: ${parsed.title}`);
console.log(`feeds: ${parsed.feeds.length}`);
const byCategory = new Map();
for (const feed of parsed.feeds) byCategory.set(feed.category, (byCategory.get(feed.category) ?? 0) + 1);
console.log('categories:', [...byCategory.entries()].map(([name, count]) => `${name}(${count})`).join(' '));

// --- unit-level parser checks -------------------------------------------------
console.log('\n--- parser checks ---');
const rss = `<rss version="2.0"><channel><title>T</title><link>https://x/</link><item><title>A &amp; B</title><link>https://x/a?b=1&amp;c=2</link><description><![CDATA[<p>Hello <b>world</b></p>]]></description><pubDate>Tue, 03 Nov 2026 10:00:00 +0800</pubDate><guid>abc</guid></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><link href="https://a/"/><entry><title>E1</title><link rel="alternate" href="https://a/e1"/><updated>2026-11-02T08:00:00Z</updated><summary type="html">&lt;p&gt;sum&lt;/p&gt;</summary><id>urn:1</id></entry></feed>`;
const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RDF</title><link>https://r/</link></channel><item><title>R1</title><link>https://r/1</link><dc:date>2026-11-01T00:00:00Z</dc:date></item></rdf:RDF>`;
for (const [name, text] of [['rss', rss], ['atom', atom], ['rdf', rdf]]) {
  const feed = parseFeed(text, { url: 'https://feed.example/f.xml' });
  console.log(name, feed.format, JSON.stringify(feed.title), 'items', feed.items.length, JSON.stringify(feed.items[0]?.title), feed.items[0]?.link, new Date(feed.items[0]?.published ?? 0).toISOString());
}

// --- live fetch checks --------------------------------------------------------
const sample = fetchAll ? parsed.feeds : parsed.feeds.slice(0, fetchCount);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feeds-test-'));
const service = new FeedService({ dataDir: dir, refreshMinutes: 0 });
await service.load();
await service.importOpml(opmlPath);
// Keep only the sampled feeds so the test is quick.
service.state.feeds = service.state.feeds.filter((feed) => sample.some((entry) => entry.url === feed.url));
await service.refresh();
const snapshot = service.snapshot();
console.log(`\n--- live fetch: ${snapshot.stats.feeds} feeds, ${snapshot.stats.items} items, ${snapshot.stats.unread} unread (baseline), ${snapshot.stats.failed} failed ---`);
for (const category of snapshot.categories) {
  for (const feed of category.feeds) {
    console.log(`${feed.error ? 'FAIL' : ' ok '}  ${feed.title}  items=${feed.itemCount} unread=${feed.unread}  ${feed.error ?? ''}`);
  }
}
const newest = snapshot.items.slice(0, 5);
for (const item of newest) {
  console.log(`  - [${item.feedTitle}] ${item.title} | ${item.link} | ${item.published ? new Date(item.published).toISOString() : 'no-date'} | summary=${item.summary.slice(0, 60)}`);
}

// mark + import persistence sanity
const first = snapshot.items[0];
if (first !== undefined) {
  await service.mark({ ids: [first.id], unread: true });
  const after = service.snapshot();
  console.log(`\nmark unread: ${after.items[0].unread === first.unread ? 'same item order' : 'order changed'}; unread now ${after.stats.unread}`);
}
await service.save();
const reopened = new FeedService({ dataDir: dir });
await reopened.load();
console.log(`state roundtrip: feeds=${reopened.state.feeds.length} items=${reopened.snapshot().stats.items}`);
await fs.rm(dir, { recursive: true, force: true });
