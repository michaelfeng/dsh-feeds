# Security

## Reporting a vulnerability

Please report security issues privately to the maintainers instead of opening a public issue.
If the repository has GitHub private vulnerability reporting enabled, use **Security → Report a
vulnerability**. Include a description, reproduction steps, affected version (see `package.json`),
and any relevant logs with personal data removed.

## Security model

`dsh-feeds` runs as a **DeepSeek Harness profile bundle**: the Host half executes with the DSH Host
process's permissions (filesystem and network), and the Client half renders inside the DSH Web GUI.
It is not a sandbox. Treat the plugin like the rest of your DSH profile.

What the plugin reads and writes:

- `dataDir` (default `~/.dsh/feeds/`) — `state.json` with subscriptions, cached items, read and
  saved-for-later markers, and `last-boot.json` diagnostics. Contains no credentials.
- Article text fetched from links that appear in your subscriptions. RSS full content is used when
  the feed provides it; otherwise the Host fetches the article page (no cookies, no auth headers).

Hardening in place:

- Article fetches reject non-`http(s)` schemes, single-label hosts, trailing-dot hostnames, and
  private/loopback/link-local IP hosts (including IPv4-mapped IPv6). Redirects are followed manually
  and each hop is re-validated; at most 4 hops are allowed.
- The same gate now covers feed URLs, discovered feed URLs and article URLs: hostnames are resolved
  (unless `allowPrivateHosts: true` is configured) and private/loopback/link-local answers are
  rejected. Article images from private hosts are dropped on the Host and again in the Client.
- Residual gap: the resolved address is not pinned for the actual request, so DNS rebinding (resolve
  public, connect private) remains theoretically possible. Do not subscribe to untrusted feeds if
  that matters for your environment.
- Reader images are loaded by the browser directly from the source site with `referrerPolicy:
  no-referrer`; the plugin does not proxy or cache images on the Host.
- No telemetry, analytics, or third-party services are used by the plugin itself.

## Threat notes for reviewers

- Feed content is untrusted input. Parsing and article extraction must not execute scripts or
  evaluate HTML/JS; links are validated (http/https) before rendering.
- The `feeds` tool is model-facing. A compromised model or prompt could add/remove subscriptions or
  read cached content; it cannot execute shell commands through this plugin.
- OPML import reads a user-supplied path; the plugin does not upload that file anywhere.
