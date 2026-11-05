/**
 * Host half of the status-notifier bundle.
 *
 * 1. SwiftBar menu bar item (macOS): maintains a live state model
 *    (pending approvals / running sessions / recently finished tasks) from
 *    durable, order-independent signals and renders it into a SwiftBar
 *    plugin script + output file, so the top-right menu bar shows the
 *    Harness status without opening the window:
 *      - `session/event` `approval/asked` / `approval/decided` audit pairs
 *      - `agent/status` running <-> idle transitions
 *      - `api-session/added` summaries for session titles
 *    The SwiftBar target directory resolves as:
 *      1. $DSH_SWIFTBAR_DIR env var, else
 *      2. the first line of ~/.dsh/swiftbar-dir.txt, else
 *      3. ~/.swiftbar (created; point SwiftBar's plugin folder at it).
 *    Rendered state files live OUTSIDE the plugin folder (SwiftBar would
 *    otherwise load the output file as a second "plugin"): they go to
 *    $DSH_SWIFTBAR_STATE_DIR, else ~/.dsh/swiftbar-state/.
 *
 * 2. Notification fallback: when NO Harness page is connected (window
 *    closed while the Host keeps running), the same two events fire macOS
 *    system notifications through `osascript`. With a live page the Client
 *    half owns notifications, so the two never double-alert.
 */
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const inject = ['subprocess', 'timer'];

const MIN_RUN_MS = 8000;
const COMPLETION_TTL_MS = 30 * 60 * 1000;
const MAX_SECTION_ROWS = 8;
const APP_NAME = 'DeepSeek Harness';
const SCRIPT_NAME = 'dsh-status.5s.sh';
const OUT_NAME = 'dsh-status.out';
const JSON_NAME = 'dsh-status.json';

const SCRIPT = `#!/bin/bash
# <xbar.title>DSH Harness 状态</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.desc>DeepSeek Harness 运行状态：待批准 / 运行中 / 任务完成（由 DSH 插件实时渲染）</xbar.desc>
DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="\${DSH_SWIFTBAR_STATE_DIR:-\$HOME/.dsh/swiftbar-state}"
STATE="\$STATE_DIR/${OUT_NAME}"
# legacy cleanup: an older version wrote state files into the plugin folder,
# which SwiftBar then loaded as extra plugins (the stray "?" item)
rm -f "\$DIR/${OUT_NAME}" "\$DIR/${JSON_NAME}" 2>/dev/null
if [ -f "\$STATE" ]; then
  cat "\$STATE"
else
  echo "○ DSH 未就绪 | color=#8E8E93"
  echo "---"
  echo "-- 打开 DeepSeek Harness | bash=/usr/bin/open param1=-a param2=\\"${APP_NAME}\\" terminal=false"
fi
`;

export function apply(ctx) {
  const isMac = typeof process !== 'undefined' && process.platform === 'darwin';

  const hasLiveClient = () => {
    const gateway = ctx.get('typertGateway');
    if (gateway && typeof gateway.hasLiveClient === 'function') return gateway.hasLiveClient();
    return true;
  };

  function notify(title, message) {
    if (!isMac) return;
    try {
      const handle = ctx.subprocess.spawn({
        argv: ['/usr/bin/osascript', '-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
        graceMs: 4000,
      });
      handle.done.catch(() => {});
    } catch (error) {
      // A notification failure must never disturb agent work.
    }
  }

  // ----- state model -----
  const approvals = new Map(); // approvalId -> { sessionId, toolName, at }
  const runningAt = new Map(); // sessionId -> startedAt
  const completions = []; // { sessionId, at }
  const titles = new Map(); // sessionId -> title

  // ----- SwiftBar target directory -----
  let pluginDir = null;
  try {
    let dir;
    if (typeof process.env.DSH_SWIFTBAR_DIR === 'string' && process.env.DSH_SWIFTBAR_DIR.length > 0) {
      dir = process.env.DSH_SWIFTBAR_DIR;
    } else {
      try {
        const hint = readFileSync(join(homedir(), '.dsh', 'swiftbar-dir.txt'), 'utf8').trim().split('\n')[0].trim();
        if (hint.length > 0) dir = hint;
      } catch (error) {}
    }
    dir = dir || join(homedir(), '.swiftbar');
    mkdirSync(dir, { recursive: true });
    pluginDir = dir;
  } catch (error) {
    pluginDir = null;
  }

  // ----- state output directory (OUTSIDE the plugin folder, so SwiftBar
  // never mistakes the rendered file for a second plugin) -----
  let stateDir = null;
  try {
    stateDir = typeof process.env.DSH_SWIFTBAR_STATE_DIR === 'string' && process.env.DSH_SWIFTBAR_STATE_DIR.length > 0
      ? process.env.DSH_SWIFTBAR_STATE_DIR
      : join(homedir(), '.dsh', 'swiftbar-state');
    mkdirSync(stateDir, { recursive: true });
  } catch (error) {
    stateDir = null;
  }

  function sanitize(value) {
    return String(value)
      .replace(/[\r\n|]/g, ' ')
      .replace(/^-+/, '')
      .trim()
      .slice(0, 60);
  }

  function sessionLabel(sessionId) {
    const title = titles.get(sessionId);
    if (typeof title === 'string' && title.length > 0) return title;
    return `会话 ${String(sessionId).slice(0, 8)}`;
  }

  function clock(now) {
    return new Date(now).toTimeString().slice(0, 8);
  }

  function render() {
    if (!stateDir || !isMac) return;
    try {
      const now = Date.now();
      for (let i = completions.length - 1; i >= 0; i -= 1) {
        if (now - completions[i].at > COMPLETION_TTL_MS) completions.splice(i, 1);
      }
      const approvalList = [...approvals.values()].sort((a, b) => a.at - b.at);
      const runningList = [...runningAt.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([sessionId, at]) => ({ sessionId, at }));
      const doneList = [...completions].sort((a, b) => b.at - a.at);

      const lines = [];
      const parts = [];
      if (approvalList.length > 0) parts.push(`⚠ ${approvalList.length}`);
      if (runningList.length > 0) parts.push(`● ${runningList.length}`);
      if (doneList.length > 0) parts.push(`✓ ${doneList.length}`);
      let color = '#8E8E93';
      if (approvalList.length > 0) color = '#FF9500';
      else if (runningList.length > 0) color = '#4D6BFE';
      else if (doneList.length > 0) color = '#34C759';
      lines.push(`${parts.length > 0 ? parts.join(' ') : '○ 空闲'} | color=${color}`);

      const open = `bash=/usr/bin/open param1=-a param2="${APP_NAME}" terminal=false refresh=false`;

      if (approvalList.length > 0) {
        lines.push('---');
        lines.push(`待批准 (${approvalList.length}) | color=#FF9500`);
        for (const item of approvalList.slice(0, MAX_SECTION_ROWS)) {
          lines.push(`-- ${sanitize(item.toolName)} · ${sanitize(sessionLabel(item.sessionId))} | ${open}`);
        }
        if (approvalList.length > MAX_SECTION_ROWS) lines.push(`-- …另有 ${approvalList.length - MAX_SECTION_ROWS} 条待批准 | ${open}`);
      }

      if (doneList.length > 0) {
        lines.push('---');
        lines.push(`任务完成 (${doneList.length}) | color=#34C759`);
        for (const item of doneList.slice(0, MAX_SECTION_ROWS)) {
          lines.push(`-- ✓ ${sanitize(sessionLabel(item.sessionId))} · ${clock(item.at)} | ${open}`);
        }
        if (doneList.length > MAX_SECTION_ROWS) lines.push(`-- …另有 ${doneList.length - MAX_SECTION_ROWS} 条已完成 | ${open}`);
      }

      if (runningList.length > 0) {
        lines.push('---');
        lines.push(`运行中 (${runningList.length}) | color=#4D6BFE`);
        for (const item of runningList.slice(0, MAX_SECTION_ROWS)) {
          lines.push(`-- ● ${sanitize(sessionLabel(item.sessionId))} · 自 ${clock(item.at)} | ${open}`);
        }
        if (runningList.length > MAX_SECTION_ROWS) lines.push(`-- …另有 ${runningList.length - MAX_SECTION_ROWS} 个会话在运行 | ${open}`);
      }

      lines.push('---');
      lines.push(`打开 DeepSeek Harness | ${open}`);
      lines.push(`上次更新 ${clock(now)} | refresh=true`);

      const tmp = join(stateDir, `${OUT_NAME}.tmp`);
      writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf8');
      renameSync(tmp, join(stateDir, OUT_NAME));
      writeFileSync(join(stateDir, JSON_NAME), JSON.stringify({
        updatedAt: new Date(now).toISOString(),
        approvals: approvalList.map((item) => ({ sessionId: item.sessionId, toolName: item.toolName, at: item.at })),
        running: runningList.map((item) => ({ sessionId: item.sessionId, since: item.at })),
        completed: doneList.map((item) => ({ sessionId: item.sessionId, at: item.at })),
      }, null, 2), 'utf8');
    } catch (error) {
      // Rendering or writing failure must never disturb agent work.
    }
  }

  function ensureScript() {
    if (!pluginDir || !isMac) return;
    try {
      const scriptPath = join(pluginDir, SCRIPT_NAME);
      const tmpPath = join(pluginDir, `${SCRIPT_NAME}.tmp`);
      writeFileSync(tmpPath, SCRIPT, { encoding: 'utf8', mode: 0o755 });
      renameSync(tmpPath, scriptPath);
      chmodSync(scriptPath, 0o755);
    } catch (error) {}
  }

  // ----- event listeners -----
  ctx.on('api-session/added', function (summary) {
    if (!summary || typeof summary.sessionId !== 'string') return;
    if (typeof summary.title === 'string' && summary.title.length > 0) {
      titles.set(summary.sessionId, summary.title);
      render();
    }
  });

  ctx.on('session/event', function (session, event) {
    if (event.type === 'approval/asked') {
      const data = event.data || {};
      const toolName = typeof data.toolName === 'string' && data.toolName.length > 0 ? data.toolName : 'tool';
      approvals.set(data.id, { sessionId: session.id, toolName, at: Date.now() });
      render();
      if (!hasLiveClient()) notify('DeepSeek Harness · 需要批准', `${toolName} 正在等待你的批准`);
      return;
    }
    if (event.type === 'approval/decided') {
      const data = event.data || {};
      if (approvals.delete(data.id)) render();
    }
  });

  ctx.on('agent/status', function (payload) {
    const { agent, status } = payload;
    if (status === 'running') {
      runningAt.set(agent.id, Date.now());
      render();
      return;
    }
    const start = runningAt.get(agent.id);
    runningAt.delete(agent.id);
    if (start === undefined) {
      render();
      return;
    }
    const ran = Date.now() - start;
    if (ran >= MIN_RUN_MS) {
      const agents = ctx.get('agents');
      const isRoot = !(agents && typeof agents.roots === 'function')
        || agents.roots().some((root) => root.id === agent.id);
      if (isRoot) {
        completions.push({ sessionId: agent.id, at: Date.now() });
        if (!hasLiveClient()) notify('DeepSeek Harness · 任务完成', '会话已空闲，可以回来查看结果了');
      }
    }
    render();
  });

  // ----- keep the menu fresh (expire completions, refresh timestamps) -----
  ctx.interval(() => render(), 60000);
  ensureScript();
  render();
}
