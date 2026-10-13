import { z } from 'zod';
import type { MuseTool } from '@/lib/models/muse';

export const queriesArgs = z.object({ queries: z.array(z.string()).min(1) });

const queriesSchema = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 8,
      description: 'Web search queries, each a short phrase a search engine would handle well.',
    },
  },
  required: ['queries'],
};

export const planTools: MuseTool[] = [
  {
    type: 'function',
    function: {
      name: 'score_queries',
      description:
        'Score drafted search queries for specificity. Returns, per query, a score from 0 (vague) to 3 (precise) and a band: vague, focused or precise.',
      parameters: queriesSchema,
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_queries',
      description: 'Submit the final list of search queries. Ends the planning phase.',
      parameters: queriesSchema,
    },
  },
];
