# Local trust and sensitive data

workwork is a local desktop companion. The renderer has Node integration disabled, context isolation and the Electron sandbox enabled, a restrictive content policy, and blocked navigation/new windows. It does not fetch remote UI or send task data to a service.

The main process can read task metadata, update agent hook settings, copy follow-ups, open source apps, and write a decision for a waiting hook. Data lives in the OS user’s profile: `~/.workwork/` on macOS/Linux and `%USERPROFILE%\.workwork` on Windows. POSIX files use owner-only modes; Windows files inherit the directory’s access controls. This is not a security boundary against another process running as that same user: such a process could read requests or forge responses. Agent hooks and their configurations must be trusted accordingly.

## Data handling

Status events retain provider/session identity, project basename, lifecycle state, timestamps, and optional cmux workspace/surface IDs. Pending approval/question files may contain commands, paths, tool arguments, and entered answers. These are needed to display the request and are removed on hook completion. The running app cleans abandoned requests and orphan responses; files can remain after a crash until it runs again. Agent settings backups remain next to the original configuration and can contain unrelated private settings.

Do not attach `~/.workwork`, agent configuration files, config backups, raw request JSON, or screenshots of real task inputs to public issues. Reproduce with synthetic data. Disconnect hooks before removing or moving the checkout, especially Cursor's optional fail-closed review gates.

## Game guide networking

Only the main process fetches public game data. Wowhead requests are bounded by time and response size; redirects must remain in the Forever database. Remote scripts and HTML never run in the renderer. Source links are restricted to the Forever database; two exact provider API-key setup URLs are also allowed. Search results are cached only in memory.

Optional conversation requests go only to the selected provider's fixed HTTPS API endpoint, with redirects disabled. Keys are encrypted using Electron `safeStorage` and written in the user profile to `~/.workwork/game-guide.json`; encryption being unavailable prevents saving. The renderer receives the configured provider/model, never a stored key. Keychain on macOS and DPAPI on Windows do not protect against malicious processes already acting as the same logged-in user.

Questions, the last three guide exchanges, and selected or retrieved public game entries go to the model provider. Coding task data is not passed to the guide. OpenAI requests set `store: false`; the provider's own data policies still apply. No model tools, shell execution, game control, or filesystem access are exposed. Model answers are untrusted text; citations link to retrieved source entries. Conversation history remains in memory and can be cleared, along with the saved key, from the guide.

## Windows hooks and builds

Native Windows hook commands invoke PowerShell with a generated encoded command. The encoding is transport, not encryption: it contains the Node and hook paths, provider, and event, with no keys. The launcher sets UTF-8, reads stdin, pipes that JSON into Node and preserves its exit code. Hook ownership requires an exact reconstruction of this generated command. Local probes hide console windows; the provider controls how its own hook process is launched.

Windows packages run with `asInvoker` and do not request administrator rights. They are unsigned. WSL and native Windows are distinct trust/runtime environments; no automatic WSL bridge is installed.

## Reporting a problem

For a suspected vulnerability, use [private vulnerability reporting](https://github.com/its-panzer/workwork/security/advisories/new). A public report should omit working exploits involving real approvals, credentials, and private task data. No response-time commitment has been set for this prototype.

Dependency scanning is one check, not a complete security audit. Native fullscreen behavior, signed distribution, and provider changes need separate release validation.
