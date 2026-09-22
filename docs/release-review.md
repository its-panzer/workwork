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

- macOS and Windows x64 desktop behavior have automated coverage. Actual WoW Forever window/fullscreen behavior remains unverified.
- Setup uses default agent configuration directories and the standard cmux application path.
- Cursor uses its own approval policy by default. Optional extra reviews gate every shell/MCP action; native questions remain in Cursor.
- Agent question dialogs outside supported hooks remain in the source app. Follow-ups are copied for manual pasting.
- Disconnect before moving the app, checkout, or Node runtime; installed hooks contain absolute paths.
- Local Mac builds use ad-hoc signing. Developer ID signing and notarization are separate distribution work. Intel builds require validation on an Intel Mac.

## Game guide update — September 21, 2026

The wordmark is half its previous width and the standard header is 60px high, down from 104px. A separate Game guide view adds Forever database search and optional OpenAI/Anthropic conversations. Source identifiers remain stable across follow-up answers. Guide requests cannot access coding task data or execute actions.

Validation for this update: 73 unit tests and the Electron UI smoke suite passed; a separate live probe exercised the renderer-to-main lookup path for Sticks and Bones, including its start/end map points. Item, NPC and spell details were also checked against Wowhead Forever. Conversation transport, follow-up context, encrypted-key configuration, error handling and citations were tested with simulated provider replies; no paid model call was made. The Apple Silicon app built and passed bundle-signature and packaged-runtime checks. Existing platform and notarization limits still apply.

## Windows port — September 21, 2026

Windows builds now include a native executable and icon, notification-area menu, Ctrl Shift Space shortcut, and portable ZIP packaging. Native Windows Claude Code, Codex and Cursor hooks use a system PowerShell launcher that preserves JSON and paths across Command Prompt, PowerShell and Git Bash. Node discovery and app opening use Windows locations; cmux discovery remains Mac-only. WSL agents are separate and are not automatically connected.

The source archive and both app packages share explicit file manifests, excluding local settings, credentials and task data. Windows conversations use Electron secure storage backed by DPAPI. Windows builds are unsigned, run without elevation, and do not change PowerShell execution policy.

Verification is recorded in the Windows, macOS and Linux jobs of the [Checks workflow](https://github.com/its-panzer/workwork/actions/workflows/ci.yml). Native Windows tests cover shell transport, installed hooks and an approval response. Desktop smoke tests use temporary profiles and synthetic requests; they do not establish compatibility with real agent sessions or games. Windows ARM64, WSL integration, code signing and interactive testing inside WoW remain outside this verification.
