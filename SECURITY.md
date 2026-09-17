# Local trust and sensitive data

workwork is a local desktop companion. The renderer has Node integration disabled, context isolation and the Electron sandbox enabled, a restrictive content policy, and blocked navigation/new windows. It does not fetch remote UI or send task data to a service.

The main process can read task metadata, update agent hook settings, copy follow-ups, open source apps, and write a decision for a waiting hook. The files in `~/.workwork/` are private to the OS user. This is not a security boundary against another process running as that same user: such a process could read requests or forge responses. Agent hooks and their configurations must be trusted accordingly.

## Data handling

Status events retain provider/session identity, project basename, lifecycle state, timestamps, and optional cmux workspace/surface IDs. Pending approval/question files may contain commands, paths, tool arguments, and entered answers. These are needed to display the request and are removed on hook completion. The running app cleans abandoned requests and orphan responses; files can remain after a crash until it runs again. Agent settings backups remain next to the original configuration and can contain unrelated private settings.

Do not attach `~/.workwork`, agent configuration files, config backups, raw request JSON, or screenshots of real task inputs to public issues. Reproduce with synthetic data. Disconnect hooks before removing or moving the checkout, especially Cursor's optional fail-closed review gates.

## Reporting a problem

For a suspected vulnerability, use [private vulnerability reporting](https://github.com/its-panzer/workwork/security/advisories/new). A public report should omit working exploits involving real approvals, credentials, and private task data. No response-time commitment has been set for this prototype.

Dependency scanning is one check, not a complete security audit. Native fullscreen behavior, signed distribution, and provider changes need separate release validation.
