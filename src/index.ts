#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Engram } from '../engram.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.ENGRAM_DB || path.join(os.homedir(), '.engram', 'memory.db');
const EMBEDDING_URL = process.env.ENGRAM_EMBEDDING_URL || 'http://192.168.68.73:11434';

// Ensure DB directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const memory = new Engram({
  dbPath: DB_PATH,
  embeddingUrl: EMBEDDING_URL,
  semanticSearch: true,
});

const server = new Server(
  { name: 'engram', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'remember',
      description: 'Store a memory entry for a session. Embeddings are generated automatically for semantic recall.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier (e.g. agent name or user ID)' },
          content: { type: 'string', description: 'The memory content to store' },
          role: { type: 'string', enum: ['user', 'assistant', 'system'], description: 'Role of the memory source', default: 'user' },
        },
        required: ['sessionId', 'content'],
      },
    },
    {
      name: 'recall',
      description: 'Retrieve relevant memories using semantic search. Falls back to keyword search if embeddings unavailable.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          query: { type: 'string', description: 'Search query — semantic similarity is used' },
          limit: { type: 'number', description: 'Max results to return (default 10)', default: 10 },
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
          sessionId: { type: 'string', description: 'Session identifier' },
          limit: { type: 'number', description: 'Max entries to return (default 20)', default: 20 },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'forget',
      description: 'Delete memories for a session. Delete all, one by ID, or entries before a date.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          id: { type: 'string', description: 'Specific memory ID to delete (optional)' },
          before: { type: 'string', description: 'ISO date string — delete entries before this date (optional)' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'stats',
      description: 'Get memory statistics for a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
        },
        required: ['sessionId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'remember': {
        const entry = await memory.remember(
          args.sessionId as string,
          args.content as string,
          (args.role as 'user' | 'assistant' | 'system') || 'user'
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
        };
      }

      case 'recall': {
        const entries = await memory.recall(
          args.sessionId as string,
          args.query as string,
          (args.limit as number) || 10
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
        };
      }

      case 'history': {
        const entries = await memory.history(
          args.sessionId as string,
          (args.limit as number) || 20
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
        };
      }

      case 'forget': {
        const options: { id?: string; before?: Date } = {};
        if (args.id) options.id = args.id as string;
        if (args.before) options.before = new Date(args.before as string);
        const deleted = await memory.forget(args.sessionId as string, options);
        return {
          content: [{ type: 'text', text: `Deleted ${deleted} memor${deleted === 1 ? 'y' : 'ies'}.` }],
        };
      }

      case 'stats': {
        const stats = await memory.stats(args.sessionId as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
        };
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
  process.stderr.write('Engram MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
