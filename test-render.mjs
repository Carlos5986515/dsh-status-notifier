// Offline functional test: stub ctx, run apply(), simulate events, inspect SwiftBar files.
import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pluginDir = new URL('./.swiftbar-test', import.meta.url).pathname;
const stateDir = new URL('./.swiftbar-state-test', import.meta.url).pathname;
process.env.DSH_SWIFTBAR_DIR = pluginDir;
process.env.DSH_SWIFTBAR_STATE_DIR = stateDir;
mkdirSync(pluginDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });

const listeners = {};
const ctx = {
  get: () => undefined,
  on: (name, fn) => { (listeners[name] ||= []).push(fn); return () => {}; },
  interval: () => () => {},
  subprocess: { spawn: () => ({ done: Promise.resolve() }) },
};

const { apply } = await import('./index.js');
apply(ctx);

const emit = (name, ...args) => { for (const fn of listeners[name] || []) fn(...args); };

console.log('--- initial (state dir, not plugin dir) ---');
console.log('out exists in state dir:', existsSync(`${stateDir}/dsh-status.out`));
console.log('script exists in plugin dir:', existsSync(`${pluginDir}/dsh-status.5s.sh`));
console.log(readFileSync(`${stateDir}/dsh-status.out`, 'utf8'));
console.log('script executable:', (statSync(`${pluginDir}/dsh-status.5s.sh`).mode & 0o111) !== 0);

// 2) approval arrives
emit('session/event', { id: 'sess-aaa' }, { type: 'approval/asked', data: { id: 'a1', toolName: 'bash | evil' } });
emit('api-session/added', { sessionId: 'sess-aaa', title: '测试会话' });
console.log('--- approval pending ---');
console.log(readFileSync(`${stateDir}/dsh-status.out`, 'utf8'));

// 3) running
emit('agent/status', { agent: { id: 'sess-aaa' }, status: 'running' });
console.log('--- running + approval (first line only) ---');
console.log(readFileSync(`${stateDir}/dsh-status.out`, 'utf8').split('\n')[0]);

// 4) decided -> gone
emit('session/event', { id: 'sess-aaa' }, { type: 'approval/decided', data: { id: 'a1' } });
console.log('--- after decided (first line only) ---');
console.log(readFileSync(`${stateDir}/dsh-status.out`, 'utf8').split('\n')[0]);

// 5) idle after MIN_RUN_MS -> completion
await new Promise((resolve) => setTimeout(resolve, 8500));
emit('agent/status', { agent: { id: 'sess-aaa' }, status: 'idle' });
console.log('--- after idle (first line only) ---');
console.log(readFileSync(`${stateDir}/dsh-status.out`, 'utf8').split('\n')[0]);

// 6) legacy cleanup: simulate an old-version stray output file in the plugin
//    dir, then run the script exactly like SwiftBar would; the stray file must
//    be removed and the state dir output printed.
writeFileSync(`${pluginDir}/dsh-status.out`, 'STRAY-LEGACY-FILE');
console.log('--- script run (bash) ---');
const rendered = execSync(`DSH_SWIFTBAR_STATE_DIR=${stateDir} bash ${pluginDir}/dsh-status.5s.sh`, { encoding: 'utf8' });
console.log(rendered.split('\n')[0], '…');
console.log('stray legacy file removed:', !existsSync(`${pluginDir}/dsh-status.out`));
