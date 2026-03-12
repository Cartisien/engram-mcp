# @cartisien/engram-mcp

> Persistent semantic memory for AI agents — MCP server powered by [@cartisien/engram](https://github.com/Cartisien/engram)

Give any MCP-compatible AI client (Claude Desktop, Cursor, Windsurf) persistent memory that survives across sessions.

```
npx -y @cartisien/engram-mcp
```

<a href="https://glama.ai/mcp/servers/Cartisien/engram-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/Cartisien/engram-mcp/badge" alt="engram-mcp MCP server" />
</a>

---

## What it does

Exposes 5 tools to any MCP client:

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with automatic embedding |
| `recall` | Semantic search across stored memories |
| `history` | Recent conversation history |
| `forget` | Delete one memory, a session, or entries before a date |
| `stats` | Memory statistics for a session |

Memories are stored in SQLite. Semantic search uses local Ollama embeddings (`nomic-embed-text`) — no API key, no cloud. Falls back to keyword search if Ollama isn't available.

---

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@cartisien/engram-mcp"],
      "env": {
        "ENGRAM_DB": "~/.engram/memory.db"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see `remember`, `recall`, `history`, `forget`, and `stats` available as tools.

### Cursor / Windsurf

Add to your MCP config:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@cartisien/engram-mcp"]
    }
  }
}
```

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ENGRAM_DB` | `~/.engram/memory.db` | SQLite database path |
| `ENGRAM_EMBEDDING_URL` | `http://localhost:11434` | Ollama base URL for embeddings |

### Local Embeddings (Recommended)

Install [Ollama](https://ollama.ai) and pull the embedding model:

```bash
ollama pull nomic-embed-text
```

Semantic search activates automatically. Without Ollama, keyword search is used.

---

## Example Usage

Once connected, your agent can:

```
remember(sessionId="myagent", content="User prefers TypeScript over JavaScript", role="user")

recall(sessionId="myagent", query="what are the user's coding preferences?", limit=5)
# Returns: [{ content: "User prefers TypeScript...", similarity: 0.82 }, ...]

history(sessionId="myagent", limit=10)

stats(sessionId="myagent")
# { total: 42, byRole: { user: 20, assistant: 22 }, withEmbeddings: 42 }
```

---

## Part of the Cartisien Memory Suite

- [`@cartisien/engram`](https://github.com/Cartisien/engram) — core memory SDK
- `@cartisien/engram-mcp` — this package, MCP server
- `@cartisien/extensa` — vector infrastructure *(coming soon)*
- `@cartisien/cogito` — agent identity & lifecycle *(coming soon)*

---

MIT © [Cartisien Interactive](https://cartisien.com)