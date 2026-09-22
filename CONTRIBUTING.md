# Contributing to workwork

Use Node.js 22.12.0 or newer and install the locked dependencies with `npm ci`. macOS and native Windows are desktop targets; WSL integration is not implemented.

## Code map

- `app/main.cjs` owns the Electron window, tray, IPC, and polling loop.
- `app/renderer.js` renders the dashboard and request forms. `app/provider-guides.js` contains setup instructions; `app/preload.cjs` exposes the narrow IPC interface.
- `src/events.cjs` normalizes status metadata and maintains task history. `src/task-model.cjs` shares provider, project-name, and ordering rules.
- `src/requests.cjs` validates actionable requests and responses. `hooks/request.cjs` waits for a decision and returns the provider's hook result.
- `src/connections.cjs` inspects connections; `scripts/setup.cjs` merges hook settings and backs them up.
- `src/platform.cjs` handles Windows hook transport, Node discovery and known app paths. Its shell round-trip test runs only on Windows.
- `src/cmux.cjs` reads session metadata and produces supported navigation URLs.
- `app/game-guide.js` owns the built-in guide view. `src/game-guide.cjs` retrieves public Forever data; `src/guide-chat.cjs` handles optional model calls, source references and encrypted key configuration. Keep network access in the main process and cover source markup changes with synthetic fixtures.
- `src/demo.cjs` holds sample data. `test/` uses temporary homes and synthetic events.
- `scripts/stage-application.cjs` stages the explicit runtime allowlist shared by `scripts/package-mac.cjs` and `scripts/package-windows.cjs`. `scripts/build-icon.cjs` regenerates `.icns` and the multi-size Windows `.ico` from the same original artwork using macOS tools; Windows builds use the committed `.ico`. Runtime hooks stay outside ASAR so ordinary Node can execute them.

Keep provider differences in the adapters. Reject unsupported request shapes and return control to the source app. Never convert a timeout, missing process, or parse error into approval. Preserve other tools' settings and hooks.

## Checks

```sh
npm run format
npm run check
npm run smoke
npm run smoke:connections
npm run build:mac       # macOS
npm run build:windows   # native Windows or cross-build
```

`check` runs formatting validation and the Node test suite, including execution of a staged app's hook with external Node. The two smoke commands need a graphical desktop session; they use separate Electron profiles and fixture agent settings. Do not replace those fixtures with a real home directory. The Mac build needs macOS and produces a locally signed app and ZIP in ignored `dist/`. CI runs build and desktop checks on macOS and Windows, plus unit tests on Linux. A Windows CI artifact contains the portable ZIP. Cross-building checks packaging only; it does not verify a Windows launch.

When changing approval handling, cover the provider output, timeout/fallback behavior, duplicate decisions, and request correlation. Keep tool inputs and conversation contents out of committed fixtures and screenshots. For visual changes, inspect the expanded pane, collapsed gem, and request forms; passing tests alone does not establish layout quality.

Hook commands installed on your own machine point at this checkout. Changes to hook definitions can require reloading and trusting them again in Codex. Disconnect hooks before moving the project. Use demo mode for UI work that does not need a real agent.

## Source handoff

`npm run source:archive` produces a source-only tarball in `artifacts/` from an explicit manifest. Add new distributable files to `scripts/source-archive.cjs`. The tarball includes the lockfile; it excludes `node_modules`, runtime state, private design notes, and test screenshots. Extract it into a fresh directory and run `npm ci` and the checks before sharing a release.

Code and original artwork use the [MIT License](LICENSE). Keep [NOTICE](NOTICE) and dependency license files with builds. Public source should contain only the manifest files; never add agent settings, runtime state, backups, or real-session captures. Use a GitHub noreply address for commits if you do not want to publish your personal email.
