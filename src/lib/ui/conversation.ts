import type { RunView } from '@/lib/events/reducer';

/** One visitor message and its answer, as the screen shows it. `pending` until the server says what kind it is. */
export interface TurnState {
  id: string;
  kind: 'pending' | 'research' | 'chat' | 'decline';
  prompt: string;
  reply?: string;
  runId?: string;
  view?: RunView;
}
