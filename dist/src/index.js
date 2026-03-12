#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const engram_1 = require("@cartisien/engram");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const DB_PATH = process.env.ENGRAM_DB || path.join(os.homedir(), '.engram', 'memory.db');
const EMBEDDING_URL = process.env.ENGRAM_EMBEDDING_URL || 'http://192.168.68.73:11434';
const GRAPH_MODEL = process.env.ENGRAM_GRAPH_MODEL || 'qwen2.5:32b';
const CONSOLIDATE_MODEL = process.env.ENGRAM_CONSOLIDATE_MODEL || 'qwen2.5:32b';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir))
    fs.mkdirSync(dbDir, { recursive: true });
const memory = new engram_1.Engram({
    dbPath: DB_PATH,
    embeddingUrl: EMBEDDING_URL,
    semanticSearch: true,
    graphMemory: process.env.ENGRAM_GRAPH === '1',
    graphModel: GRAPH_MODEL,
    consolidateModel: CONSOLIDATE_MODEL,
});
const server = new index_js_1.Server({ name: 'engram', version: '0.3.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: [
        // ── Session memory ──────────────────────────────────────────────────
        {
            name: 'remember',
            description: 'Store a memory entry for a session. Embeddings and graph extraction happen automatically.',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                    content: { type: 'string', description: 'Memory content to store' },
                    role: { type: 'string', enum: ['user', 'assistant', 'system'], default: 'user' },
                    metadata: { type: 'object', description: 'Optional key-value metadata' },
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
                    sessionId: { type: 'string', description: 'Session identifier' },
                    query: { type: 'string', description: 'Search query' },
                    limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
                    userId: { type: 'string', description: 'Optional: also blend in this user\'s cross-session memories' },
                    tiers: { type: 'string', description: 'Comma-separated tiers to search: working,long_term,archived (default: working,long_term)' },
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
                    limit: { type: 'number', description: 'Max entries (default 20)', default: 20 },
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
                    sessionId: { type: 'string', description: 'Session identifier' },
                    id: { type: 'string', description: 'Specific memory ID to delete (optional)' },
                    before: { type: 'string', description: 'ISO date — delete entries before this date (optional)' },
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
                    sessionId: { type: 'string', description: 'Session identifier' },
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
                    sessionId: { type: 'string', description: 'Session identifier' },
                    batch: { type: 'number', description: 'Number of memories to consolidate (default 50)' },
                    keep: { type: 'number', description: 'Most recent N to leave untouched (default 20)' },
                    dryRun: { type: 'boolean', description: 'Preview summaries without writing (default false)' },
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
                    sessionId: { type: 'string', description: 'Session identifier' },
                    entity: { type: 'string', description: 'Entity name to look up (case-insensitive)' },
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
                    userId: { type: 'string', description: 'User identifier' },
                    content: { type: 'string', description: 'Memory content to store' },
                    role: { type: 'string', enum: ['user', 'assistant', 'system'], default: 'user' },
                    metadata: { type: 'object', description: 'Optional key-value metadata' },
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
                    userId: { type: 'string', description: 'User identifier' },
                    query: { type: 'string', description: 'Search query (optional — returns all if omitted)' },
                    limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
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
                    userId: { type: 'string', description: 'User identifier' },
                    id: { type: 'string', description: 'Specific memory ID (optional)' },
                    before: { type: 'string', description: 'ISO date — delete entries before this date (optional)' },
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
                    userId: { type: 'string', description: 'User identifier' },
                    batch: { type: 'number', description: 'Number of memories to consolidate (default 50)' },
                    keep: { type: 'number', description: 'Most recent N to leave untouched (default 20)' },
                    dryRun: { type: 'boolean', description: 'Preview without writing (default false)' },
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
                    userId: { type: 'string', description: 'User identifier' },
                },
                required: ['userId'],
            },
        },
        // ── Temporal & export tools ────────────────────────────────────────
        {
            name: 'recall_by_time',
            description: 'Query memories using natural language time expressions like "yesterday", "last week", "this morning", "before 3pm".',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                    expression: { type: 'string', description: 'Natural language time expression like "yesterday", "last week", "before Monday"' },
                    limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
                },
                required: ['sessionId', 'expression'],
            },
        },
        {
            name: 'recall_recent',
            description: 'Get the N most recent memories for a session — no query needed.',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                    limit: { type: 'number', description: 'Number of recent memories to return (default 20)', default: 20 },
                },
                required: ['sessionId'],
            },
        },
        {
            name: 'daily_summary',
            description: 'Returns a summary of memories for a given date (YYYY-MM-DD), or today if omitted.',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                    date: { type: 'string', description: 'ISO date string YYYY-MM-DD (optional, defaults to today)' },
                },
                required: ['sessionId'],
            },
        },
        {
            name: 'temporal_stats',
            description: 'Returns temporal statistics about when memories were created — frequency over time, most active periods.',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                },
                required: ['sessionId'],
            },
        },
        {
            name: 'export_memories',
            description: 'Export all session memories as markdown or JSON.',
            inputSchema: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Session identifier' },
                    format: { type: 'string', enum: ['markdown', 'json'], description: 'Export format (default "markdown")', default: 'markdown' },
                },
                required: ['sessionId'],
            },
        },
    ],
}));
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
        switch (name) {
            // ── Session ──────────────────────────────────────────────────────
            case 'remember': {
                const entry = await memory.remember(args.sessionId, args.content, args.role || 'user', args.metadata);
                return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
            }
            case 'recall': {
                const tiers = args.tiers
                    ? args.tiers.split(',').map(t => t.trim())
                    : undefined;
                const entries = await memory.recall(args.sessionId, args.query, args.limit || 10, {
                    tiers,
                    userId: args.userId,
                });
                return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
            }
            case 'history': {
                const entries = await memory.history(args.sessionId, args.limit || 20);
                return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
            }
            case 'forget': {
                const opts = {};
                if (args.id)
                    opts.id = args.id;
                if (args.before)
                    opts.before = new Date(args.before);
                const deleted = await memory.forget(args.sessionId, opts);
                return { content: [{ type: 'text', text: `Deleted ${deleted} memor${deleted === 1 ? 'y' : 'ies'}.` }] };
            }
            case 'stats': {
                const stats = await memory.stats(args.sessionId);
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
            case 'consolidate': {
                const result = await memory.consolidate(args.sessionId, {
                    batch: args.batch,
                    keep: args.keep,
                    dryRun: args.dryRun,
                });
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'graph': {
                const result = await memory.graph(args.sessionId, args.entity);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            // ── User-scoped ───────────────────────────────────────────────────
            case 'remember_user': {
                const entry = await memory.rememberUser(args.userId, args.content, args.role || 'user', args.metadata);
                return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
            }
            case 'recall_user': {
                const entries = await memory.recallUser(args.userId, args.query, args.limit || 10);
                return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
            }
            case 'forget_user': {
                const opts = {};
                if (args.id)
                    opts.id = args.id;
                if (args.before)
                    opts.before = new Date(args.before);
                const deleted = await memory.forgetUser(args.userId, opts);
                return { content: [{ type: 'text', text: `Deleted ${deleted} user memor${deleted === 1 ? 'y' : 'ies'}.` }] };
            }
            case 'consolidate_user': {
                const result = await memory.consolidateUser(args.userId, {
                    batch: args.batch,
                    keep: args.keep,
                    dryRun: args.dryRun,
                });
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'user_stats': {
                const stats = await memory.userStats(args.userId);
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
            // ── Temporal & export ────────────────────────────────────────────
            case 'recall_by_time': {
                const entries = await memory.recallByTime(args.sessionId, args.expression, args.limit || 10);
                return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
            }
            case 'recall_recent': {
                const entries = await memory.recallRecent(args.sessionId, args.limit || 20);
                return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
            }
            case 'daily_summary': {
                const summary = await memory.dailySummary(args.sessionId, args.date);
                return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
            }
            case 'temporal_stats': {
                const stats = await memory.temporalStats(args.sessionId);
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
            case 'export_memories': {
                const format = args.format || 'markdown';
                const entries = await memory.history(args.sessionId, 9999);
                if (format === 'json') {
                    return { content: [{ type: 'text', text: JSON.stringify({ count: entries.length, memories: entries }, null, 2) }] };
                }
                const md = entries.map((e) => `## [${e.timestamp || e.created_at}] [${e.role}]\n${e.content}\n---`).join('\n\n');
                return { content: [{ type: 'text', text: `# Exported ${entries.length} memories\n\n${md}` }] };
            }
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('Engram MCP server v0.3.0 running\n');
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
});
