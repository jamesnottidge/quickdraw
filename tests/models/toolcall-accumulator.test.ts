import { describe, it, expect } from 'vitest';
import { ToolCallAccumulator } from '@/lib/models/toolcall-accumulator';

describe('ToolCallAccumulator', () => {
  it('assembles fragmented arguments per index and reports the call start once', () => {
    const acc = new ToolCallAccumulator();
    const a = acc.addDelta([{ index: 0, id: 'c1', function: { name: 'score_queries', arguments: '' } }]);
    expect(a.started).toEqual([{ index: 0, name: 'score_queries' }]);
    const b = acc.addDelta([{ index: 0, function: { arguments: '{"que' } }]);
    expect(b.started).toEqual([]);
    acc.addDelta([{ index: 0, function: { arguments: 'ries":["a","b"]}' } }]);
    const { complete, invalid } = acc.finish();
    expect(invalid).toEqual([]);
    expect(complete).toEqual([
      { id: 'c1', name: 'score_queries', args: { queries: ['a', 'b'] }, rawArgs: '{"queries":["a","b"]}' },
    ]);
  });

  it('keeps interleaved parallel calls apart', () => {
    const acc = new ToolCallAccumulator();
    acc.addDelta([
      { index: 0, id: 'c1', function: { name: 'x', arguments: '{"a"' } },
      { index: 1, id: 'c2', function: { name: 'y', arguments: '{"b"' } },
    ]);
    acc.addDelta([
      { index: 1, function: { arguments: ':2}' } },
      { index: 0, function: { arguments: ':1}' } },
    ]);
    const { complete } = acc.finish();
    expect(complete.map((c) => [c.name, c.args])).toEqual([
      ['x', { a: 1 }],
      ['y', { b: 2 }],
    ]);
  });

  it('marks truncated or malformed JSON as invalid instead of guessing', () => {
    const acc = new ToolCallAccumulator();
    acc.addDelta([{ index: 0, id: 'c1', function: { name: 'submit_queries', arguments: '{"queries":["a"' } }]);
    const { complete, invalid } = acc.finish();
    expect(complete).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ id: 'c1', name: 'submit_queries', rawArgs: '{"queries":["a"' });
    expect(invalid[0].error).toMatch(/JSON/i);
  });

  it('treats empty arguments as an empty object, generates a missing id, and flags a missing name', () => {
    const acc = new ToolCallAccumulator();
    acc.addDelta([{ index: 0, function: { name: 'noargs' } }]);
    acc.addDelta([{ index: 1, id: 'c2', function: { arguments: '{}' } }]);
    const { complete, invalid } = acc.finish();
    expect(complete[0]).toMatchObject({ name: 'noargs', args: {} });
    expect(complete[0].id).toBeTruthy();
    expect(invalid[0]).toMatchObject({ id: 'c2', error: expect.stringMatching(/name/i) });
  });
});
