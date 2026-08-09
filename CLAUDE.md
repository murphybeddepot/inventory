# Bedrock — Claude conventions

Static web app deployed straight from this repo. iPads on the shop floor load it. No build step, no test suite, no linter — the version chip at the bottom-right of the page is the visual proof a deploy landed.

## Repo layout
- `index.html` — the app, inline `<script>`. Visible tabs: Pre-Pack, Pack, Cabinets, Ground. Hidden admin tabs: Stock, Count, Inventory, Barcodes, Log, Export.
- `pack.js` — Pack-tab logic, extracted at v9.13. Kept at global scope so inline `onclick=` handlers resolve without `window.*` shims. Loaded with a `?v=X.XX` cache-bust to defeat the service worker.
- `apple-touch-icon.png`, `favicon-32.png` — Bedrock branding (settled at v9.30/v9.34).
- No package.json, no dependencies, no bundler. Don't add one without asking.

## Backend it talks to
- **Ground Orchestrator** over HTTP via `groundApi(action, args)`. URL + shared secret live in browser localStorage (`mbd_ground_orch_url`, `mbd_ground_secret`); set up via the `#setup?secret=…&url=…` hash + QR flow. **Never commit either value.**
- **Anthropic API** called directly from the page — three `anthropic-version: 2023-06-01` callsites in `index.html`.

## Commits
- **Version chip bump on every user-facing change.** Pattern: `v10.X short description`. Bump the pill in `index.html` (`title="Tap for system status">v10.1472` near the bottom).
- **Pill and `pack.js?v=X.X` cache-bust MUST always match, even if `pack.js` didn't change.** The `.github/workflows` PWA-safety validation fails the deploy otherwise. Devices' service workers cache `pack.js` by URL — if the pill moves but the cache-bust doesn't, they keep serving the old JS against the new HTML (v10.1472 hotfix existed for exactly this: I bumped the pill and forgot the cache-bust on v10.1470 + v10.1471). Update BOTH strings in the same commit.
- **Project-metadata commits** (this file, `.gitignore`, README, etc. — nothing iPads serve) skip the version bump.
- Match the existing terse commit style. **No "Generated with Claude Code" footer, no claude.ai session URL** in commit messages.
- Single author: `office@murphybeddepot.com`. No co-author tags.

## Branching — depends on device
- **Desktop session (laptop with full diff visible):** commit straight to `main`, push, done. Matches existing history.
- **Mobile session (phone/tablet):** always work on a branch named `claude/<short-task>`, push the branch, and stop there. Do not merge to `main` and do not push to `main` from a phone session. The branch + GitHub diff is the review gate before iPads pick up the change.
- If you can't tell which device the user is on, **ask before pushing.**

## Code style already established
- Comments explain *why*, not *what*. The codebase has no `TODO`/`FIXME` markers — don't introduce them. If something is genuinely deferred, leave a one-line `// X deferred — <reason>` and move on.
- Inline-style DOM construction (string-concatenated HTML with inline `style="…"`) is the existing pattern. Don't "modernize" to template literals, components, or a framework — that's a different project.
- No bug-fix-adjacent refactors. No new abstractions speculatively.
- No `.md` planning/scratch docs committed. Conversation context only.

## Deferred (known, not actionable as TODOs)
- Full ES module migration of `pack.js` and the inline `<script>` in `index.html`.
- Items table is localStorage-only (`mbd_items`); cloud sync planned later.
- Cycle-counting day-of-week → bucket schedule is hard-coded; admin UI planned later.

## Don't do without asking
- Force push, `git reset --hard`, history rewrites, branch deletion.
- Touch icons / favicon HTML — branding is settled.
- Add dependencies, a bundler, or new service-worker logic.
- Rename `mbd_*` localStorage keys — those are baked into iPads already in the field.
