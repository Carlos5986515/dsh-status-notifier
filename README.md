# DSH Status Notifier

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) bundle that puts your agent's live
status in the macOS menu bar — so you can see pending approvals and finished tasks without switching back to the
Harness window.

## What it shows

| Menu bar | Meaning |
| --- | --- |
| `⚠ 1` (orange) | A permission request is waiting for your approval |
| `● 1` (blue) | A task is running |
| `✓ 1` (green) | A task finished less than 30 minutes ago |
| `○ 空闲` (gray) | Idle |

Clicking the item opens a dropdown listing the sessions behind each state; any row (or the "打开 DeepSeek Harness"
row) brings the Harness window back. It refreshes every 5 seconds.

It also fires macOS system notifications while the page is away (window hidden or unfocused), and through
`osascript` when the window is closed but the Host keeps running — so a long task can finish while you are in
another app and you still get told. The two notification paths never double-alert: the Host only notifies when no
page is connected.

## How it works

Two halves, one bundle:

- **Host half** (`index.js`) runs in the DSH Host process:
  - observes durable, order-independent signals — `session/event` with `approval/asked` / `approval/decided`
    (the approval audit pair appended by the Approval service) and `agent/status` running↔idle transitions;
  - renders a SwiftBar script (`dsh-status.5s.sh`) plus its output into the plugin folder; the rendered state
    files live **outside** the plugin folder, so SwiftBar never mistakes them for plugins;
  - falls back to `osascript` notifications when no page is connected.
- **Client half** (`client.js`) runs in the Web GUI: watches the framework's own `uiSession.sessionStatus`
  (running / pendingInteraction / completionUnread) and fires browser notifications when the window is away.

## Requirements

- macOS with [SwiftBar](https://swiftbar.github.io/SwiftBar/) (`brew install --cask swiftbar`)
- DeepSeek Harness with plugin bundle support

## Installation

1. Clone this repository anywhere, or copy the folder into your workspace.
2. Install the bundle in DSH — Plugin Manager → install local bundle, or ask your agent to run `plugin_manager`
   `install_bundle` with this directory as the target.
3. Make SwiftBar watch the folder:
   - create `~/.swiftbar` and point SwiftBar's Preferences → General → Plugin Folder at it, or
   - keep SwiftBar's own folder and write its path into the first line of `~/.dsh/swiftbar-dir.txt`.
4. Restart DeepSeek Harness so the Host half loads. The menu bar item appears within a few seconds.

## Configuration

| Variable / file | Purpose |
| --- | --- |
| `DSH_SWIFTBAR_DIR` | SwiftBar plugin folder (else `~/.dsh/swiftbar-dir.txt`, else `~/.swiftbar`) |
| `~/.dsh/swiftbar-dir.txt` | First line: the plugin folder path |
| `DSH_SWIFTBAR_STATE_DIR` | Where rendered state files go (default `~/.dsh/swiftbar-state`) |

## Development

`test-render.mjs` runs the Host half against a stubbed Cordis context, simulates approval / running / idle
events, and checks the rendered SwiftBar output and the legacy-file cleanup:

```bash
node test-render.mjs
```

## Notes and limits

- The menu bar item is a SwiftBar script: SwiftBar must be running for the item to appear.
- Clicking a row brings the Harness window back; deep-linking straight into a specific session is not supported
  yet.
- State directories are resolved when the plugin loads; after changing them, restart DeepSeek Harness.

## License

MIT — see [LICENSE](LICENSE).
