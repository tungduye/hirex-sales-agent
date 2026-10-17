import test from 'node:test';
import assert from 'node:assert/strict';
import { newestBuildTime, shouldRestartForBuild } from '../scripts/deplao-realtime-supervisor.mjs';

// After "npm run build" (adapter) or "npm run build:electron" (Deplao) the supervisor restarts both
// processes by itself, so a new build never runs with the old code still loaded.
test('newest build time ignores files that cannot be read (mid-build)', () => {
  const times = { a: 100, b: 300 };
  const stat = (file) => { if (!(file in times)) throw new Error('ENOENT'); return { mtimeMs: times[file] }; };
  assert.equal(newestBuildTime(['a', 'b', 'missing'], stat), 300);
  assert.equal(newestBuildTime(['missing'], stat), 0);
});

test('restart only for a build newer than the running processes, after it has been quiet', () => {
  const startedAt = 1_000_000;
  assert.equal(shouldRestartForBuild(startedAt - 1, startedAt, startedAt + 60_000), false, 'old build: no restart');
  assert.equal(shouldRestartForBuild(startedAt + 5_000, startedAt, startedAt + 10_000), false, 'still writing: wait');
  assert.equal(shouldRestartForBuild(startedAt + 5_000, startedAt, startedAt + 25_000), true, 'finished: restart');
  assert.equal(shouldRestartForBuild(0, startedAt, startedAt + 25_000), false, 'nothing readable: no restart');
});
