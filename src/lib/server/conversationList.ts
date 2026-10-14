import type { AppConfig } from '@/lib/config';
import { reapStaleRuns } from '@/lib/limits/reaper';
import type { Db } from '@/lib/store/db';
import { listConversationsForDevice, type ConversationListItem } from '@/lib/store/conversations';

/** The sidebar list. Stale runs are reaped first so a killed run does not show as running forever. */
export async function getConversationList(
  db: Db,
  config: AppConfig,
  deviceId: string | undefined,
  now = new Date(),
): Promise<ConversationListItem[]> {
  if (!deviceId) return [];
  try {
    await reapStaleRuns(db, config, now);
  } catch (e) {
    console.error('reapStaleRuns failed while listing conversations', e);
  }
  return listConversationsForDevice(db, deviceId, 50);
}
