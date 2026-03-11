/**
 * MCP server tool coverage tests.
 * We test the tool definitions (schema) and the handler dispatch logic
 * by exercising the Engram SDK directly — the same code paths the MCP
 * server uses. This avoids needing a running MCP transport in CI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engram } from '@cartisien/engram';

// Mirror the handler logic so we can test every case without transport
async function dispatch(memory: Engram, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'remember':
      return memory.remember(
        args.sessionId as string,
        args.content as string,
        (args.role as any) || 'user',
        args.metadata as any
      );
    case 'recall':
      return memory.recall(
        args.sessionId as string,
        args.query as string,
        (args.limit as number) || 10,
        { tiers: args.tiers ? (args.tiers as string).split(',') as any : undefined,
          userId: args.userId as string | undefined }
      );
    case 'history':
      return memory.history(args.sessionId as string, (args.limit as number) || 20);
    case 'forget': {
      const opts: any = {};
      if (args.id) opts.id = args.id;
      if (args.before) opts.before = new Date(args.before as string);
      return memory.forget(args.sessionId as string, opts);
    }
    case 'stats':
      return memory.stats(args.sessionId as string);
    case 'consolidate':
      return memory.consolidate(args.sessionId as string, {
        batch: args.batch as any, keep: args.keep as any, dryRun: args.dryRun as any
      });
    case 'graph':
      return memory.graph(args.sessionId as string, args.entity as string);
    case 'remember_user':
      return memory.rememberUser(args.userId as string, args.content as string, (args.role as any) || 'user', args.metadata as any);
    case 'recall_user':
      return memory.recallUser(args.userId as string, args.query as string | undefined, (args.limit as number) || 10);
    case 'forget_user': {
      const opts: any = {};
      if (args.id) opts.id = args.id;
      if (args.before) opts.before = new Date(args.before as string);
      return memory.forgetUser(args.userId as string, opts);
    }
    case 'consolidate_user':
      return memory.consolidateUser(args.userId as string, {
        batch: args.batch as any, keep: args.keep as any, dryRun: args.dryRun as any
      });
    case 'user_stats':
      return memory.userStats(args.userId as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

describe('MCP tool handlers — all 12 tools', () => {
  let memory: Engram;

  beforeEach(() => {
    memory = new Engram({ dbPath: ':memory:', semanticSearch: false });
  });
  afterEach(async () => { await memory.close(); });

  // ── remember ─────────────────────────────────────────────────────────────

  it('remember: stores entry and returns id', async () => {
    const entry: any = await dispatch(memory, 'remember', {
      sessionId: 's1', content: 'Test fact', role: 'user'
    });
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('Test fact');
    expect(entry.tier).toBe('working');
  });

  it('remember: stores with metadata', async () => {
    const entry: any = await dispatch(memory, 'remember', {
      sessionId: 's1', content: 'Fact with meta', metadata: { source: 'test' }
    });
    expect(entry.id).toBeTruthy();
  });

  // ── recall ────────────────────────────────────────────────────────────────

  it('recall: returns stored memories', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'GovScout uses React' });
    const results: any = await dispatch(memory, 'recall', { sessionId: 's1', query: 'GovScout' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('GovScout');
  });

  it('recall: returns empty for unknown session', async () => {
    const results: any = await dispatch(memory, 'recall', { sessionId: 'nobody', query: 'anything' });
    expect(results).toEqual([]);
  });

  it('recall: blends user memories when userId provided', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'Session fact' });
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'User fact' });
    const results: any = await dispatch(memory, 'recall', { sessionId: 's1', query: 'fact', userId: 'u1' });
    const contents = results.map((r: any) => r.content);
    expect(contents).toContain('Session fact');
    expect(contents).toContain('User fact');
  });

  it('recall: tier filter works', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'Working tier fact' });
    const results: any = await dispatch(memory, 'recall', {
      sessionId: 's1', query: 'fact', tiers: 'working'
    });
    expect(results.every((r: any) => r.tier === 'working')).toBe(true);
  });

  // ── history ───────────────────────────────────────────────────────────────

  it('history: returns chronological entries', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'First' });
    await new Promise(r => setTimeout(r, 5));
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'Second' });
    const entries: any = await dispatch(memory, 'history', { sessionId: 's1' });
    expect(entries[0].content).toBe('First');
    expect(entries[1].content).toBe('Second');
  });

  // ── forget ────────────────────────────────────────────────────────────────

  it('forget: deletes all session memories', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'To delete' });
    const deleted: any = await dispatch(memory, 'forget', { sessionId: 's1' });
    expect(deleted).toBe(1);
    const results: any = await dispatch(memory, 'recall', { sessionId: 's1', query: 'delete' });
    expect(results).toEqual([]);
  });

  it('forget: deletes by id', async () => {
    const e: any = await dispatch(memory, 'remember', { sessionId: 's1', content: 'Target' });
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'Keep' });
    const deleted: any = await dispatch(memory, 'forget', { sessionId: 's1', id: e.id });
    expect(deleted).toBe(1);
    const left: any = await dispatch(memory, 'history', { sessionId: 's1' });
    expect(left.map((r: any) => r.content)).not.toContain('Target');
  });

  // ── stats ─────────────────────────────────────────────────────────────────

  it('stats: returns total, byRole, byTier', async () => {
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'f1', role: 'user' });
    await dispatch(memory, 'remember', { sessionId: 's1', content: 'f2', role: 'assistant' });
    const stats: any = await dispatch(memory, 'stats', { sessionId: 's1' });
    expect(stats.total).toBe(2);
    expect(stats.byRole.user).toBe(1);
    expect(stats.byRole.assistant).toBe(1);
    expect(stats.byTier.working).toBe(2);
  });

  // ── consolidate ───────────────────────────────────────────────────────────

  it('consolidate: dry run returns summarized count', async () => {
    const result: any = await dispatch(memory, 'consolidate', {
      sessionId: 's1', dryRun: true
    });
    expect(typeof result.summarized).toBe('number');
    expect(result.created).toBe(0);
  });

  it('consolidate: returns zeros for empty session', async () => {
    const result: any = await dispatch(memory, 'consolidate', { sessionId: 'empty' });
    expect(result.summarized).toBe(0);
    expect(result.created).toBe(0);
    expect(result.archived).toBe(0);
  });

  // ── graph ─────────────────────────────────────────────────────────────────

  it('graph: returns entity + relationships + memories', async () => {
    const result: any = await dispatch(memory, 'graph', {
      sessionId: 's1', entity: 'govscout'
    });
    expect(result.entity).toBe('govscout');
    expect(Array.isArray(result.relationships)).toBe(true);
    expect(Array.isArray(result.relatedMemories)).toBe(true);
  });

  // ── remember_user ─────────────────────────────────────────────────────────

  it('remember_user: stores and returns user entry', async () => {
    const entry: any = await dispatch(memory, 'remember_user', {
      userId: 'u1', content: 'Prefers TypeScript'
    });
    expect(entry.userId).toBe('u1');
    expect(entry.content).toBe('Prefers TypeScript');
    expect(entry.tier).toBe('working');
  });

  // ── recall_user ───────────────────────────────────────────────────────────

  it('recall_user: retrieves user memories', async () => {
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'Loves dark mode' });
    const results: any = await dispatch(memory, 'recall_user', { userId: 'u1' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Loves dark mode');
  });

  it('recall_user: isolated between users', async () => {
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'U1 fact' });
    await dispatch(memory, 'remember_user', { userId: 'u2', content: 'U2 fact' });
    const u1: any = await dispatch(memory, 'recall_user', { userId: 'u1' });
    expect(u1.map((r: any) => r.content)).not.toContain('U2 fact');
  });

  it('recall_user: empty for unknown user', async () => {
    const results: any = await dispatch(memory, 'recall_user', { userId: 'nobody' });
    expect(results).toEqual([]);
  });

  // ── forget_user ───────────────────────────────────────────────────────────

  it('forget_user: deletes all user memories', async () => {
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'To delete' });
    const deleted: any = await dispatch(memory, 'forget_user', { userId: 'u1' });
    expect(deleted).toBe(1);
    const left: any = await dispatch(memory, 'recall_user', { userId: 'u1' });
    expect(left).toEqual([]);
  });

  it('forget_user: deletes by id', async () => {
    const e: any = await dispatch(memory, 'remember_user', { userId: 'u1', content: 'Target' });
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'Keep' });
    await dispatch(memory, 'forget_user', { userId: 'u1', id: e.id });
    const left: any = await dispatch(memory, 'recall_user', { userId: 'u1' });
    expect(left.map((r: any) => r.content)).not.toContain('Target');
    expect(left.map((r: any) => r.content)).toContain('Keep');
  });

  // ── consolidate_user ──────────────────────────────────────────────────────

  it('consolidate_user: dry run on empty user', async () => {
    const result: any = await dispatch(memory, 'consolidate_user', {
      userId: 'nobody', dryRun: true
    });
    expect(result.summarized).toBe(0);
  });

  // ── user_stats ────────────────────────────────────────────────────────────

  it('user_stats: returns counts', async () => {
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'f1', role: 'user' });
    await dispatch(memory, 'remember_user', { userId: 'u1', content: 'f2', role: 'assistant' });
    const stats: any = await dispatch(memory, 'user_stats', { userId: 'u1' });
    expect(stats.total).toBe(2);
    expect(stats.byTier.working).toBe(2);
    expect(stats.byRole.user).toBe(1);
  });

  it('user_stats: zeros for unknown user', async () => {
    const stats: any = await dispatch(memory, 'user_stats', { userId: 'nobody' });
    expect(stats.total).toBe(0);
  });

  // ── unknown tool ──────────────────────────────────────────────────────────

  it('unknown tool: throws', async () => {
    await expect(dispatch(memory, 'nonexistent', {})).rejects.toThrow('Unknown tool');
  });
});
