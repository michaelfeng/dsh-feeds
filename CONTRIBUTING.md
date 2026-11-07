# Contributing to dsh-feeds

Thanks for helping improve the plugin. This project is a DeepSeek Harness profile bundle: a Host half
(plugin code) and a Client half (a plain browser module rendered in the DSH Web GUI).

## Development setup

- Node.js **22+** (CI runs on 22 and 24).
- No dependencies are required for the plugin itself; the test suite is plain `node:test`.

```bash
npm run check      # syntax check of index.js / feeds-core.js / client.js
npm test           # offline test suite (no network)
npm run benchmark  # synthetic query/transfer benchmark
```

To exercise the plugin inside DSH, install this directory as a bundle:

```text
plugin_manager install_bundle /absolute/path/to/dsh-feeds
```

After editing Host files, disable/enable the `feeds` plugin row (or restart DSH) to reload them; after
editing Client files, refresh the Web page.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.js` | Host plugin: route registration, `feeds` tool, boot/refresh scheduling |
| `feeds-core.js` | Pure core: OPML/feed parsing, fetching, article extraction, durable state |
| `client.js` | Client module: `sidebar.panellist` row + `main` panel, React without JSX or imports |
| `locale/` | Display metadata and UI copy (`en`, `zh`); keep inline dictionaries and JSON in sync |
| `tests/` | Offline tests; add a regression test for every bug fix |
| `tools/` | Manual smoke script and benchmark, not part of the test suite |
| `CONTRACT.md` | Host ↔ Client RPC/field contract; update it when either side changes |
| `SECURITY.md` | Security model and private vulnerability reporting |

## Coding rules

- **Host**: ESM, Node built-ins only, no new runtime dependencies. Mutations go through `_mutate` so a
  failed save rolls back. Never persist anything outside `dataDir`.
- **Client**: a single plain-JS module loaded through `window.__ModuleLoader__.load`; only
  `require('react')`. No JSX, no `import`, no Harness package imports. Use theme tokens
  (`--dsw-alias-*`) only — no literal colors. Every listener/timer must live in a `React.useEffect`
  with cleanup.
- **i18n**: every visible string goes through the `feeds` locale namespace; add the key to both inline
  dictionaries and both `locale/*.json` files, then keep key sets identical.
- **Contract**: new or changed RPC fields/actions must be reflected in `CONTRACT.md` and, when
  user-visible, in `README.md`.
- **Security**: treat feed content as untrusted. Do not add `innerHTML`/`eval`, keep URL allow-lists,
  and keep the article/feed SSRF gate for any new network fetch.

## Testing in a profile

1. Install the bundle (above).
2. Run `npm test` and `npm run check` before opening a PR.
3. Manually verify the affected flow in the Web UI (information source flow, add/import, category
   move/delete, reading pane) and mention what you verified in the PR.
4. Never commit personal data: `state.json`, screenshots with real subscriptions, tokens, or the
   `.internal/`/`.backups/` directories are ignored and must stay untracked.

## Pull requests

- Keep changes focused; one behavior change per PR.
- Add tests for new logic and for every fixed bug.
- Update `CHANGELOG.md` for user-visible changes.
- Describe: what changed, why, how you verified it (commands + UI steps), and anything still unverified.

## Commit style

Conventional-ish prefixes are appreciated: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Reporting issues

Use the GitHub issue templates. Include the plugin version, DSH version, OS, reproduction steps, and
redacted logs. Security issues must be reported privately per [SECURITY.md](SECURITY.md).
