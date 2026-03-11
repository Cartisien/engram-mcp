#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Engram } from '@cartisien/engram';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.ENGRAM_DB || path.join(os.homedir(), '.engram', 'memory.db');
const EMBEDDING_URL = process.env.ENGRAM_EMBEDDING_URL || 'http://192.168.68.73:11434';
const GRAPH_MODEL = process.env.ENGRAM_GRAPH_MODEL || 'qwen2.5:32b';
const CONSOLIDATE_MODEL = process.env.ENGRAM_CONSOLIDATE_MODEL || 'qwen2.5:32b';

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const memory = new Engram({
  dbPath: DB_PATH,
  embeddingUrl: EMBEDDING_URL,
  semanticSearch: true,
  graphMemory: process.env.ENGRAM_GRAPH === '1',
  graphModel: GRAPH_MODEL,
  consolidateModel: CONSOLIDATE_MODEL,
});

const server = new Server(
  { name: 'engram', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Session memory ──────────────────────────────────────────────────
    {
      name: 'remember',
      description: 'Store a memory entry for a session. Embeddings and graph extraction happen automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          content:    { type: 'string', description: 'Memory content to store' },
          role:       { type: 'string', enum: ['user', 'assistant', 'system'], default: 'user' },
          metadata:   { type: 'object', description: 'Optional key-value metadata' },
        },
        required: ['sessionId', 'content'],
      },
    },
    {
      name: 'recall',
      description: 'Retrieve relevant memories via semantic search (falls back to keyword). Searches working + long_term tiers. Pass userId to blend in cross-session user facts.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          query:      { type: 'string', description: 'Search query' },
          limit:      { type: 'number', description: 'Max results (default 10)', default: 10 },
          userId:     { type: 'string', description: 'Optional: also blend in this user\'s cross-session memories' },
          tiers:      { type: 'string', description: 'Comma-separated tiers to search: working,long_term,archived (default: working,long_term)' },
        },
        required: ['sessionId', 'query'],
      },
    },
    {
      name: 'history',
      description: 'Get recent conversation history for a session in chronological order.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          limit:      { type: 'number', description: 'Max entries (default 20)', default: 20 },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'forget',
      description: 'Delete session memories. Delete all, one by ID, or entries before a date.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          id:         { type: 'string', description: 'Specific memory ID to delete (optional)' },
          before:     { type: 'string', description: 'ISO date — delete entries before this date (optional)' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'stats',
      description: 'Memory statistics for a session — total, by role, by tier (working/long_term/archived), graph counts.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'consolidate',
      description: 'Consolidate old working memories into dense long-term summaries via LLM. Archives originals.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          batch:      { type: 'number', description: 'Number of memories to consolidate (default 50)' },
          keep:       { type: 'number', description: 'Most recent N to leave untouched (default 20)' },
          dryRun:     { type: 'boolean', description: 'Preview summaries without writing (default false)' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'graph',
      description: 'Query the knowledge graph for an entity — returns relationships and source memories. Requires ENGRAM_GRAPH=1.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId:  { type: 'string', description: 'Session identifier' },
          entity:     { type: 'string', description: 'Entity name to look up (case-insensitive)' },
        },
        required: ['sessionId', 'entity'],
      },
    },
    // ── User-scoped (cross-session) memory ──────────────────────────────
    {
      name: 'remember_user',
      description: 'Store a user-scoped memory that persists across all sessions. Use for preferences, identity, long-term facts.',
      inputSchema: {
        type: 'object',
        properties: {
          userId:     { type: 'string', description: 'User identifier' },
          content:    { type: 'string', description: 'Memory content to store' },
          role:       { type: 'string', enum: ['user', 'assistant', 'system'], default: 'user' },
          metadata:   { type: 'object', description: 'Optional key-value metadata' },
        },
        required: ['userId', 'content'],
      },
    },
    {
      name: 'recall_user',
      description: 'Recall user-scoped memories — works from any session context.',
      inputSchema: {
        type: 'object',
        properties: {
          userId:     { type: 'string', description: 'User identifier' },
          query:      { type: 'string', description: 'Search query (optional — returns all if omitted)' },
          limit:      { type: 'number', description: 'Max results (default 10)', default: 10 },
        },
        required: ['userId'],
      },
    },
    {
      name: 'forget_user',
      description: 'Delete user-scoped memories.',
      inputSchema: {
        type: 'object',
        properties: {
          userId:     { type: 'string', description: 'User identifier' },
          id:         { type: 'string', description: 'Specific memory ID (optional)' },
          before:     { type: 'string', description: 'ISO date — delete entries before this date (optional)' },
        },
        required: ['userId'],
      },
    },
    {
      name: 'consolidate_user',
      description: 'Consolidate user-scoped working memories into long-term summaries.',
      inputSchema: {
        type: 'object',
        properties: {
          userId:     { type: 'string', description: 'User identifier' },
          batch:      { type: 'number', description: 'Number of memories to consolidate (default 50)' },
          keep:       { type: 'number', description: 'Most recent N to leave untouched (default 20)' },
          dryRun:     { type: 'boolean', description: 'Preview without writing (default false)' },
        },
        required: ['userId'],
      },
    },
    {
      name: 'user_stats',
      description: 'Memory statistics for a user — total, by role, by tier.',
      inputSchema: {
        type: 'object',
        properties: {
          userId:     { type: 'string', description: 'User identifier' },
        },
        required: ['userId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {

      // ── Session ──────────────────────────────────────────────────────

      case 'remember': {
        const entry = await memory.remember(
          args.sessionId as string,
          args.content as string,
          (args.role as 'user' | 'assistant' | 'system') || 'user',
          args.metadata as Record<string, unknown> | undefined
        );
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
      }

      case 'recall': {
        const tiers = args.tiers
          ? (args.tiers as string).split(',').map(t => t.trim()) as any
          : undefined;
        const entries = await memory.recall(
          args.sessionId as string,
          args.query as string,
          (args.limit as number) || 10,
          {
            tiers,
            userId: args.userId as string | undefined,
          }
        );
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }

      case 'history': {
        const entries = await memory.history(
          args.sessionId as string,
          (args.limit as number) || 20
        );
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }

      case 'forget': {
        const opts: Parameters<typeof memory.forget>[1] = {};
        if (args.id) opts.id = args.id as string;
        if (args.before) opts.before = new Date(args.before as string);
        const deleted = await memory.forget(args.sessionId as string, opts);
        return { content: [{ type: 'text', text: `Deleted ${deleted} memor${deleted === 1 ? 'y' : 'ies'}.` }] };
      }

      case 'stats': {
        const stats = await memory.stats(args.sessionId as string);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      case 'consolidate': {
        const result = await memory.consolidate(args.sessionId as string, {
          batch:  args.batch  as number | undefined,
          keep:   args.keep   as number | undefined,
          dryRun: args.dryRun as boolean | undefined,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'graph': {
        const result = await memory.graph(
          args.sessionId as string,
          args.entity as string
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // ── User-scoped ───────────────────────────────────────────────────

      case 'remember_user': {
        const entry = await memory.rememberUser(
          args.userId as string,
          args.content as string,
          (args.role as 'user' | 'assistant' | 'system') || 'user',
          args.metadata as Record<string, unknown> | undefined
        );
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
      }

      case 'recall_user': {
        const entries = await memory.recallUser(
          args.userId as string,
          args.query as string | undefined,
          (args.limit as number) || 10
        );
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }

      case 'forget_user': {
        const opts: Parameters<typeof memory.forgetUser>[1] = {};
        if (args.id) opts.id = args.id as string;
        if (args.before) opts.before = new Date(args.before as string);
        const deleted = await memory.forgetUser(args.userId as string, opts);
        return { content: [{ type: 'text', text: `Deleted ${deleted} user memor${deleted === 1 ? 'y' : 'ies'}.` }] };
      }

      case 'consolidate_user': {
        const result = await memory.consolidateUser(args.userId as string, {
          batch:  args.batch  as number | undefined,
          keep:   args.keep   as number | undefined,
          dryRun: args.dryRun as boolean | undefined,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'user_stats': {
        const stats = await memory.userStats(args.userId as string);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Engram MCP server v0.2.0 running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
