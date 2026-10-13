import type { AppConfig } from '@/lib/config';
import { reapStaleRuns } from '@/lib/limits/reaper';
import type { Db } from '@/lib/store/db';
import { listRunsForDevice, type RunListItem } from '@/lib/store/runs';

export async function getRunList(
  db: Db,
  config: AppConfig,
  deviceId: string | undefined,
  now = new Date(),
): Promise<RunListItem[]> {
  if (!deviceId) return [];
  try {
    await reapStaleRuns(db, config, now);
  } catch (e) {
    console.error('reapStaleRuns failed while listing runs', e);
  }
  return listRunsForDevice(db, deviceId, 50);
}
