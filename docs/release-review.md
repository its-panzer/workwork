# Source release review — September 17, 2026

This release contains buildable source, original artwork, and synthetic tests. It starts with an empty live profile; demo mode is explicit and isolated. It is a macOS prototype, with a locally buildable app rather than a notarized binary release.

## Review changes

- Incomplete Claude Code/Codex permission payloads return to the source app instead of offering an approval without tool details.
- Pending request files are validated by request kind before reaching the renderer. Malformed question groups, form fields, schemas, and approval previews are discarded.
- Disconnecting an unconfigured agent leaves missing settings files and existing hook-free settings unchanged.
- Filter buttons expose their selected state. Claude question choices use labeled fieldsets.
- Removed unused quit IPC and duplicate filter styling updates; request validation shares provider and question rules.
- New installs have no task data or installed hooks. Receiver tests never create real task rows.
- README starts with live setup; fictional demos remain opt-in. The MIT license and notices ship in the source archive and Mac app.
- Mac packaging copies Electron notices after extracting the runtime, so a fresh checkout can build without first launching Electron.
- Short windows use a compact header and spacing to keep a simple approval's controls visible. Desktop smoke checks cover 600px, 640px, and both sides of the 720px layout breakpoint.

## Source and privacy boundary

The publication set comes from `scripts/source-archive.cjs`, an explicit file manifest. It excludes runtime state, agent settings and backups, local notes, real-session captures, attachments, dependencies, and compiled apps. Source archives strip filesystem ownership and extended attributes. The README interface captures come from the isolated demo and contain only fictional tasks.

The app includes only original artwork. PNG metadata is limited to rendering information; provenance is described in `app/assets/README.md`. Documentation composites use an official Blizzard screenshot as a static backdrop, with credit and separate ownership recorded in `docs/images/README.md` and `NOTICE`. The backdrop is not packaged in the app or covered by the MIT license. The composites do not establish in-game compatibility.

The public repository starts with fresh Git history. Commits use a GitHub noreply address. Only the intended public repository owner appears in repository URLs; personal names, private email addresses, real home paths, private project names, and real session IDs are excluded.

## Verification

Local verification used a fresh source-archive extraction on an Apple Silicon Mac with the minimum supported Node.js version, 22.12.0:

- `npm ci` and `npm run check`: formatting and all 62 tests passed.
- `npm run smoke` and `npm run smoke:connections`: passed with temporary profiles and synthetic hook subprocesses, including empty first launch.
- `npm run build:mac`: built the app and ZIP without an existing Electron runtime. The bundle signature, packaged runtime launch, and included license files passed inspection.
- Dependency audit: no known vulnerabilities reported. Source secret scan, explicit personal-marker scan, and asset metadata inspection completed.

The final publication check also verifies the committed file manifest, clean commit history, and [hosted CI](https://github.com/its-panzer/workwork/actions). These checks do not answer real requests or establish compatibility with every agent release.

## Scope limits

- macOS is the exercised desktop platform. WoW Forever window/fullscreen behavior and Windows remain unverified.
- Setup uses default agent configuration directories and the standard cmux application path.
- Cursor uses its own approval policy by default. Optional extra reviews gate every shell/MCP action; native questions remain in Cursor.
- Agent question dialogs outside supported hooks remain in the source app. Follow-ups are copied for manual pasting.
- Disconnect before moving the app, checkout, or Node runtime; installed hooks contain absolute paths.
- Local Mac builds use ad-hoc signing. Developer ID signing and notarization are separate distribution work. Intel builds require validation on an Intel Mac.
