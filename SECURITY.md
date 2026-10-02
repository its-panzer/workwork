# Local trust and sensitive data

workwork is a local desktop companion. The renderer has Node integration disabled, context isolation and the Electron sandbox enabled, a restrictive content policy, and blocked navigation/new windows. It does not fetch remote UI or send task data to a service.

The main process can read task metadata, update agent hook settings, copy follow-ups, open source apps, and write a decision for a waiting hook. Data lives in the OS user’s profile: `~/.workwork/` on macOS/Linux and `%USERPROFILE%\.workwork` on Windows. POSIX files use owner-only modes; Windows files inherit the directory’s access controls. This is not a security boundary against another process running as that same user: such a process could read requests or forge responses. Agent hooks and their configurations must be trusted accordingly.

## Data handling

Status events retain provider/session identity, project basename, lifecycle state, timestamps, and optional cmux workspace/surface IDs. Pending approval/question files may contain commands, paths, tool arguments, and entered answers. These are needed to display the request and are removed on hook completion. The running app cleans abandoned requests and orphan responses; files can remain after a crash until it runs again. Agent settings backups remain next to the original configuration and can contain unrelated private settings.

Do not attach `~/.workwork`, agent configuration files, config backups, raw request JSON, or screenshots of real task inputs to public issues. Reproduce with synthetic data. Disconnect hooks before removing or moving the checkout, especially Cursor's optional fail-closed review gates.

## Game guide networking

Only the main process fetches public game data for the optional Lookup view. Chat does not make automatic Wowhead requests. Wowhead requests are bounded by time and response size; redirects must remain in the Forever database. Remote scripts and HTML never run in the renderer. Source links are restricted to the Forever database; exact provider setup and ChatGPT usage URLs are also allowed. Search results are cached only in memory.

Optional conversation requests go only to the selected provider's fixed HTTPS API endpoint, with redirects disabled. Keys are encrypted using Electron `safeStorage` and written in the user profile to `~/.workwork/game-guide.json`; encryption being unavailable prevents saving. The renderer receives the configured provider/model, never a stored key. Keychain on macOS and DPAPI on Windows do not protect against malicious processes already acting as the same logged-in user.

**Continue with ChatGPT** opens OpenAI's authorization flow in the system browser. The main process handles the temporary loopback callback, checks OAuth state and PKCE, validates the ID token and granted scopes, and stores encrypted account profiles. Profiles contain the stable host ID, account/client mapping and OAuth credentials. Tokens remain in the main process and are never returned to the renderer. Workwork does not reuse credentials from Codex or another app.

The ChatGPT profile store also uses `safeStorage`, with atomic owner-only writes on POSIX and no plaintext fallback. Rotated refresh tokens are saved with the new access token and expiry. **Sign out** clears local credentials and attempts remote revocation; a failed or unsupported remote revocation is reported, so local disconnection is not proof that OpenAI revoked the session. Stable host IDs and account/client mappings are retained for later sign-ins. Use **Manage usage** to review access and limits in ChatGPT. Workwork never switches accounts or starts separately billed API calls automatically when ChatGPT usage is unavailable.

Questions, the last three guide exchanges, and any selected public game entry go directly to the model provider in one request. Selected entries are projected to bounded public fields, and source URLs are reconstructed from a validated entry type and ID. Coding task data is not passed to the guide. OpenAI requests set `store: false`; the provider's own data policies still apply. No model tools, shell execution, game control, or filesystem access are exposed. Model answers are untrusted text based on model knowledge and supplied context; numbered citations refer to selected entries. Conversation history remains in memory and can be cleared from the guide. Switching a provider or account starts a fresh guide conversation.

The optional Workwork Character addon records only the logged-in character through WoW's addon API. WoW writes its SavedVariables file on reload or logout. Workwork reads that file without executing Lua. **Include saved character context** is off by default. When selected, the main process reads the latest snapshot and sends a projection containing level, class, race, specialization, zone, equipment, stats, client version and timestamps. Character name, realm, money, raw item links and file paths are omitted. Quest progress is not captured. The raw snapshot context is attached only to the current request and is not added to conversation history, although model answers can repeat details from it. Unchecking stops further snapshot attachments; starting a new conversation also clears previous messages. **Prepare for Gaming bot** copies a dated snapshot into the local workwork profile and places a prompt on the clipboard; the user chooses whether to send that prompt to Grok Bot. The exported JSON contains character identity, equipment and stats and should not be attached to public reports. Grok Bot local-computer permissions are managed in Grok Bot.

## Windows hooks and builds

Native Windows hook commands invoke PowerShell with a generated encoded command. The encoding is transport, not encryption: it contains the Node and hook paths, provider, and event, with no keys. The launcher sets UTF-8, reads stdin, pipes that JSON into Node and preserves its exit code. Hook ownership requires an exact reconstruction of this generated command. Local probes hide console windows; the provider controls how its own hook process is launched.

Windows packages run with `asInvoker` and do not request administrator rights. They are unsigned. WSL and native Windows are distinct trust/runtime environments; no automatic WSL bridge is installed.

## Reporting a problem

For a suspected vulnerability, use [private vulnerability reporting](https://github.com/its-panzer/workwork/security/advisories/new). A public report should omit working exploits involving real approvals, credentials, and private task data. No response-time commitment has been set for this prototype.

Dependency scanning is one check, not a complete security audit. Native fullscreen behavior, signed distribution, and provider changes need separate release validation.
