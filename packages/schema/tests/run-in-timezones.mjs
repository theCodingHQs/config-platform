// Runs the date tests once per time zone: date code that passes in one zone can still shift
// days in another, so results must be identical in all of them.
import { spawnSync } from 'node:child_process';

const ZONES = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'];
let failed = false;
for (const zone of ZONES) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', 'tests/dates.test.ts', 'tests/report-schedules.test.ts'], {
    env: { ...process.env, TZ: zone },
    stdio: 'inherit',
  });
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
