import { createHash } from 'crypto';
import { open, Database as SQLiteDatabase } from 'sqlite';

export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export interface RecallOptions {
  limit?: number;
  before?: Date;
  after?: Date;
  role?: 'user' | 'assistant' | 'system';
}

export interface EngramConfig {
  dbPath?: string;
  maxContextLength?: number;
  embeddingUrl?: string;
  embeddingModel?: string;
  semanticSearch?: boolean;
}

/**
 * Engram - Persistent memory for AI assistants
 *
 * A lightweight, SQLite-backed memory system that gives your AI assistants
 * the ability to remember conversations across sessions.
 * v0.2 adds semantic search via Ollama embeddings (nomic-embed-text).
 *
 * @example
 * ```typescript
 * import { Engram } from '@cartisien/engram';
 *
 * const memory = new Engram({ dbPath: './memory.db' });
 *
 * // Store a memory
 * await memory.remember('user_123', 'User prefers dark mode and TypeScript', 'user');
 *
 * // Retrieve relevant memories semantically
 * const context = await memory.recall('user_123', 'What are this user\'s preferences?', 5);
 * ```
 */
export class Engram {
  private db!: SQLiteDatabase;
  private maxContextLength: number;
  private dbPath: string;
  private initialized: boolean = false;
  private embeddingUrl: string;
  private embeddingModel: string;
  private semanticSearch: boolean;

  constructor(config: EngramConfig = {}) {
    this.dbPath = config.dbPath || ':memory:';
    this.maxContextLength = config.maxContextLength || 4000;
    this.embeddingUrl = config.embeddingUrl || 'http://192.168.68.73:11434';
    this.embeddingModel = config.embeddingModel || 'nomic-embed-text';
    this.semanticSearch = config.semanticSearch !== false;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;

    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        content_hash TEXT NOT NULL,
        embedding TEXT
      );
    `);

    // Add embedding column if upgrading from v0.1
    try {
      await this.db.exec(`ALTER TABLE memories ADD COLUMN embedding TEXT`);
    } catch {
      // Column already exists, ignore
    }

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_timestamp
      ON memories(session_id, timestamp DESC);
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_content
      ON memories(content);
    `);

    this.initialized = true;
  }

  /**
   * Fetch embedding vector from Ollama
   */
  private async embed(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${this.embeddingUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return null;
      const data = await response.json() as { embedding: number[] };
      return data.embedding ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Store a memory entry
   */
  async remember(
    sessionId: string,
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    await this.init();

    const id = createHash('sha256')
      .update(`${sessionId}:${content}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16);

    const contentHash = createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 16);

    const truncated = content.slice(0, this.maxContextLength);

    // Fetch embedding if semantic search enabled
    let embeddingJson: string | null = null;
    if (this.semanticSearch) {
      const vector = await this.embed(truncated);
      if (vector) embeddingJson = JSON.stringify(vector);
    }

    const entry: MemoryEntry = {
      id,
      sessionId,
      content: truncated,
      role,
      timestamp: new Date(),
      metadata
    };

    await this.db.run(
      `INSERT INTO memories (id, session_id, content, role, timestamp, metadata, content_hash, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.sessionId,
        entry.content,
        entry.role,
        entry.timestamp.getTime(),
        metadata ? JSON.stringify(metadata) : null,
        contentHash,
        embeddingJson
      ]
    );

    return entry;
  }

  /**
   * Recall memories for a session.
   *
   * With semantic search enabled (default), embeds the query and ranks
   * results by cosine similarity. Falls back to keyword search if Ollama
   * is unreachable or no embeddings are stored.
   */
  async recall(
    sessionId: string,
    query?: string,
    limit: number = 10,
    options: RecallOptions = {}
  ): Promise<MemoryEntry[]> {
    await this.init();

    // Build base query
    let sql = `
      SELECT id, session_id, content, role, timestamp, metadata, embedding
      FROM memories
      WHERE session_id = ?
    `;
    const params: (string | number)[] = [sessionId];

    if (options.role) {
      sql += ` AND role = ?`;
      params.push(options.role);
    }
    if (options.after) {
      sql += ` AND timestamp >= ?`;
      params.push(options.after.getTime());
    }
    if (options.before) {
      sql += ` AND timestamp <= ?`;
      params.push(options.before.getTime());
    }

    // Try semantic search
    if (query && query.trim() && this.semanticSearch) {
      const queryVector = await this.embed(query);
      if (queryVector) {
        sql += ` ORDER BY timestamp DESC`;
        const rows = await this.db.all(sql, params);

        // Score each row by cosine similarity
        const scored = rows
          .map((row: any) => {
            let similarity = 0;
            if (row.embedding) {
              try {
                const vec: number[] = JSON.parse(row.embedding);
                similarity = this.cosineSimilarity(queryVector, vec);
              } catch { /* malformed, skip */ }
            }
            return { row, similarity };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        return scored.map(({ row, similarity }) => ({
          id: row.id,
          sessionId: row.session_id,
          content: row.content,
          role: row.role,
          timestamp: new Date(row.timestamp),
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          similarity
        }));
      }
      // Ollama unreachable — fall through to keyword search
    }

    // Keyword fallback
    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      if (keywords.length > 0) {
        sql += ` AND (` + keywords.map(() => `LOWER(content) LIKE ?`).join(' OR ') + `)`;
        params.push(...keywords.map(k => `%${k}%`));
      }
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, params);
    return rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Get recent conversation history for a session
   */
  async history(sessionId: string, limit: number = 20): Promise<MemoryEntry[]> {
    return this.recall(sessionId, undefined, limit, {});
  }

  /**
   * Forget (delete) memories
   */
  async forget(
    sessionId: string,
    options?: { before?: Date; id?: string }
  ): Promise<number> {
    await this.init();

    if (options?.id) {
      const result = await this.db.run(
        'DELETE FROM memories WHERE session_id = ? AND id = ?',
        [sessionId, options.id]
      );
      return result.changes || 0;
    }

    let sql = 'DELETE FROM memories WHERE session_id = ?';
    const params: (string | number)[] = [sessionId];

    if (options?.before) {
      sql += ' AND timestamp < ?';
      params.push(options.before.getTime());
    }

    const result = await this.db.run(sql, params);
    return result.changes || 0;
  }

  /**
   * Get memory statistics for a session
   */
  async stats(sessionId: string): Promise<{
    total: number;
    byRole: Record<string, number>;
    oldest: Date | null;
    newest: Date | null;
    withEmbeddings: number;
  }> {
    await this.init();

    const totalRow = await this.db.get(
      'SELECT COUNT(*) as count FROM memories WHERE session_id = ?',
      [sessionId]
    );
    const total = totalRow?.count || 0;

    const roleRows = await this.db.all(
      'SELECT role, COUNT(*) as count FROM memories WHERE session_id = ? GROUP BY role',
      [sessionId]
    );
    const byRole: Record<string, number> = {};
    roleRows.forEach((row: any) => { byRole[row.role] = row.count; });

    const range = await this.db.get(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM memories WHERE session_id = ?',
      [sessionId]
    );

    const embRow = await this.db.get(
      'SELECT COUNT(*) as count FROM memories WHERE session_id = ? AND embedding IS NOT NULL',
      [sessionId]
    );

    return {
      total,
      byRole,
      oldest: range?.oldest ? new Date(range.oldest) : null,
      newest: range?.newest ? new Date(range.newest) : null,
      withEmbeddings: embRow?.count || 0
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.initialized = false;
    }
  }
}

export default Engram;
