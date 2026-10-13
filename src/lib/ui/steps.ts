import type { RunView } from '@/lib/events/reducer';

export type StepKey = 'plan' | 'search' | 'read' | 'write' | 'interactive';
export type StepStatus = 'pending' | 'active' | 'completed' | 'error';

export interface Step {
  key: StepKey;
  label: string;
  status: StepStatus;
  summary: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deriveSteps(view: RunView): Step[] {
  const running = view.status === 'running';
  const broken = view.status === 'failed' || view.status === 'interrupted';

  const searches = Object.values(view.searches);
  const planDone = view.submitted.length > 0;
  const searchDone = planDone && searches.length >= view.submitted.length && searches.every((r) => r !== null);
  const writeStarted = view.report.length > 0 || view.reportDone;
  const readDone = writeStarted || (view.status === 'finished' && searchDone);
  const results = searches.reduce((n, r) => n + (r?.length ?? 0), 0);
  const used = view.pageOrder.filter((u) => view.pages[u].status === 'summarized').length;

  const steps: Step[] = [
    {
      key: 'plan',
      label: 'Plan',
      status: planDone ? 'completed' : running ? 'active' : 'pending',
      summary: planDone ? plural(view.submitted.length, 'query', 'queries') : view.rounds.length ? `round ${view.rounds.length}` : 'drafting queries',
    },
    {
      key: 'search',
      label: 'Search',
      status: searchDone ? 'completed' : planDone && running && searches.length > 0 ? 'active' : 'pending',
      summary: searches.length ? plural(results, 'result') : 'waiting',
    },
    {
      key: 'read',
      label: 'Read',
      status: readDone ? 'completed' : searchDone && running ? 'active' : 'pending',
      summary: view.pageOrder.length ? `${used} of ${plural(view.pageOrder.length, 'page')} used` : 'waiting',
    },
    {
      key: 'write',
      label: 'Write',
      status: view.reportDone ? 'completed' : readDone && running ? 'active' : 'pending',
      summary: view.reportDone ? 'report ready' : writeStarted ? 'writing the report' : 'waiting',
    },
  ];

  const oldRun = view.status === 'finished' && view.artifact.status === 'idle';
  if (!oldRun) {
    const a = view.artifact;
    steps.push({
      key: 'interactive',
      label: 'Interactive view',
      status: a.status === 'ready' ? 'completed' : a.status === 'building' ? 'active' : a.status === 'failed' ? 'error' : 'pending',
      summary: a.status === 'ready' ? 'ready' : a.status === 'building' ? 'building' : a.status === 'failed' ? (a.reason ?? 'failed') : 'waiting',
    });
  }

  if (broken) {
    const active = steps.find((s) => s.status === 'active');
    const target = active ?? steps.find((s) => s.status === 'pending');
    if (target) target.status = 'error';
  }
  return steps;
}
