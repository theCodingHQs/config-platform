/**
 * Checks for due report emails every minute. Safe to run on several servers at once: each due
 * schedule is claimed by exactly one of them (see reportScheduleService.runDue).
 * Set REPORT_SCHEDULER=off to stop this server from sending scheduled reports.
 */
import { reportScheduleService } from './report-schedule-service.js';

let timer: NodeJS.Timeout | null = null;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    // Keeps going while a whole batch was due (e.g. many schedules at 07:00)
    while ((await reportScheduleService.runDue(5)) === 5) {
      /* next batch */
    }
  } catch (err) {
    console.error('[report-scheduler] failed to run due schedules:', err);
  } finally {
    busy = false;
  }
}

export function startReportScheduler(intervalMs = 60_000): void {
  if (timer || process.env.REPORT_SCHEDULER === 'off') return;
  timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
}

export function stopReportScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
