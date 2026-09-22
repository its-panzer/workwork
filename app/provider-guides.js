/* Setup copy is kept separate from renderer behavior. */
const setupGuides = {
  claude: {
    description:
      'Activity, tool approvals, and supported questions. Works in native terminal sessions.',
    steps: [
      'Click Connect here, or use Connect all three, to install the local hooks.',
      'Open or resume Claude Code. Complete its normal workspace trust prompt if one appears; hook changes usually load automatically.',
      'Continue a task. Look for Receiving activity here, then check Needs you for approvals and supported questions.',
    ],
    help: 'No activity? Check /hooks in Claude Code. If workwork is missing, click Reconnect here, then restart Claude Code and resume your task.',
  },
  codex: {
    description:
      'Activity and supported approvals from standalone Codex or Codex in a terminal. Questions stay in Codex.',
    steps: [
      'Click Connect here, or use Connect all three, to install the local hooks.',
      'In the Codex app, open Settings → Hooks → Reload hooks. In the Codex CLI, open /hooks.',
      'Review and trust the entries pointing to workwork/hooks. Codex skips new or changed hooks until you trust them.',
      'Continue a task. Receiving activity confirms Codex is connected. Existing standalone tasks are not imported.',
    ],
    help: 'No activity? Check that the workwork hooks are enabled and trusted in the Codex instance you use. Test local receiver only checks workwork’s end of the connection.',
  },
  cursor: {
    description:
      'Local Agent activity with Cursor’s own approval settings. Required approvals and questions stay in Cursor.',
    steps: [
      'Click Connect here, or use Connect all three, to install the local hooks.',
      'Open a local project and continue an Agent chat in Cursor. Hooks reload automatically; look for Receiving activity here.',
      'Keep Using Cursor’s settings to respect the session’s auto-run policy. Review every action is an optional extra gate, even for actions Cursor would run automatically.',
    ],
    help: 'No activity? Check Cursor’s Customize → Hooks or its Hooks output channel. Reconnect here if the hooks are missing; restart Cursor if it still does not receive the changes. Cloud agents are not connected.',
  },
};
