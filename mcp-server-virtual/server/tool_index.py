"""Tool-search index behind ``/mcp/search``.

Each tool's name and description is embedded and stored in Lakebase (pgvector)
alongside a Postgres full-text vector. A search runs both rankings and merges them
with reciprocal-rank fusion, so exact terms ("jira") and paraphrases ("schedule a
meeting") both match.

Backends:
- Lakebase, when the ``postgres`` app resource is bound (PGHOST + PGENDPOINT).
- In-process, otherwise or if Lakebase can't be initialized; it is rebuilt after
  every restart.

The index only ranks. Callers pass the tool names the user can list right now, and
take tool metadata from that listing, so one user's tools never reach another.

Embeddings are computed as the app's service principal with the endpoint bound as
the ``serving-endpoint`` resource. If embedding fails, tools are still indexed and
searched by keyword.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import math
import os
import re
import threading
import time

import psycopg
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError
from psycopg import sql

log = logging.getLogger(__name__)

DEFAULT_EMBEDDING_ENDPOINT = "databricks-gte-large-en"
# The Lakebase column is VECTOR(1024), so the endpoint must emit 1024-d vectors
# (databricks-gte-large-en and databricks-bge-large-en do).
EMBEDDING_DIM = 1024
DEFAULT_TOP_N = int(os.environ.get("VIRTUAL_MCP_SEARCH_TOP_N", "5"))
MAX_TOP_N = 25
INDEX_SCHEMA = os.environ.get("VIRTUAL_MCP_INDEX_SCHEMA", "virtual_mcp")
_EMBED_BATCH_SIZE = 32
# Reciprocal-rank-fusion damping constant from the original RRF paper.
_RRF_K = 60
# Lakebase OAuth credentials expire after an hour; reconnect well before that.
_CREDENTIAL_MAX_AGE_S = 40 * 60
# The in-process keyword ranking skips these; Postgres's english config does the same.
_STOPWORDS = frozenset(
    "the and for with from that this what when where which who how are was were can you "
    "your our out all any into about some have has had not but get".split()
)


def _sql(template: str) -> sql.Composed:
    """Compose a statement on the index table; the schema name is quoted as an identifier."""
    return sql.SQL(template).format(
        schema=sql.Identifier(INDEX_SCHEMA),
        tools=sql.Identifier(INDEX_SCHEMA, "tools"),
        dim=sql.Literal(EMBEDDING_DIM),
    )


@functools.cache
def _workspace_client() -> WorkspaceClient:
    return WorkspaceClient()


def embedding_endpoint() -> str:
    return os.environ.get("EMBEDDING_ENDPOINT") or DEFAULT_EMBEDDING_ENDPOINT


def tool_text(name: str, description: str) -> str:
    # "github__search_issues" -> "github search issues", so the name's words count.
    return f"{name.replace('__', ' ').replace('_', ' ')}: {description}"


def _content_hash(tool: dict) -> str:
    raw = json.dumps([tool["name"], tool["description"], tool["input_schema"]], sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def embed(texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        resp = _workspace_client().api_client.do(
            "POST",
            f"/serving-endpoints/{embedding_endpoint()}/invocations",
            body={"input": texts[i : i + _EMBED_BATCH_SIZE]},
        )
        rows = sorted(resp["data"], key=lambda r: r.get("index", 0))
        vectors.extend(r["embedding"] for r in rows)
    if vectors and len(vectors[0]) != EMBEDDING_DIM:
        raise ValueError(
            f"{embedding_endpoint()} returned {len(vectors[0])}-d embeddings; "
            f"the index needs {EMBEDDING_DIM}-d (e.g. databricks-gte-large-en)"
        )
    return vectors


def _query_terms(query: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", query.lower()) if t not in _STOPWORDS]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class LakebaseIndex:
    backend = "lakebase"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._conn: psycopg.Connection | None = None
        self._connected_at = 0.0
        self._schema_ready = False

    def _connect(self) -> psycopg.Connection:
        credential = _workspace_client().postgres.generate_database_credential(
            endpoint=os.environ["PGENDPOINT"]
        )
        return psycopg.connect(
            host=os.environ["PGHOST"],
            port=int(os.environ.get("PGPORT", "5432")),
            dbname=os.environ.get("PGDATABASE", "databricks_postgres"),
            user=os.environ["PGUSER"],
            password=credential.token,
            sslmode=os.environ.get("PGSSLMODE", "require"),
            autocommit=True,
            connect_timeout=15,
        )

    def _run(self, fn):
        """Run fn(conn), reconnecting when the credential is near expiry or the
        connection dropped (Lakebase scales to zero)."""
        with self._lock:
            for attempt in (1, 2):
                stale = time.time() - self._connected_at > _CREDENTIAL_MAX_AGE_S
                if self._conn is None or self._conn.closed or stale:
                    if self._conn is not None:
                        self._conn.close()
                    self._conn = self._connect()
                    self._connected_at = time.time()
                    if not self._schema_ready:
                        self._create_schema(self._conn)
                        self._schema_ready = True
                try:
                    return fn(self._conn)
                except psycopg.OperationalError:
                    self._conn.close()
                    self._conn = None
                    if attempt == 2:
                        raise
        return None

    @staticmethod
    def _create_schema(conn: psycopg.Connection) -> None:
        try:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        except psycopg.errors.InsufficientPrivilege:
            pass  # fine if the project owner already installed it; the next DDL tells
        conn.execute(_sql("CREATE SCHEMA IF NOT EXISTS {schema}"))
        conn.execute(
            _sql(
                """
            CREATE TABLE IF NOT EXISTS {tools} (
              name         TEXT PRIMARY KEY,
              alias        TEXT NOT NULL,
              description  TEXT NOT NULL,
              input_schema JSONB NOT NULL,
              content_hash TEXT NOT NULL,
              embedding    VECTOR({dim}),
              tsv          TSVECTOR GENERATED ALWAYS AS (
                             to_tsvector('english', replace(name, '_', ' ') || ' ' || description)
                           ) STORED,
              updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )"""
            )
        )
        conn.execute(
            _sql(
                "CREATE INDEX IF NOT EXISTS tools_embedding_idx ON {tools} "
                "USING hnsw (embedding vector_cosine_ops)"
            )
        )
        conn.execute(_sql("CREATE INDEX IF NOT EXISTS tools_tsv_idx ON {tools} USING gin (tsv)"))

    def hashes(self) -> dict[str, str]:
        query = _sql("SELECT name, content_hash FROM {tools}")
        return dict(self._run(lambda c: c.execute(query).fetchall()))

    def upsert(self, rows: list[dict]) -> None:
        statement = _sql(
            """
            INSERT INTO {tools}
              (name, alias, description, input_schema, content_hash, embedding, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s::vector, now())
            ON CONFLICT (name) DO UPDATE SET
              alias = EXCLUDED.alias, description = EXCLUDED.description,
              input_schema = EXCLUDED.input_schema, content_hash = EXCLUDED.content_hash,
              embedding = EXCLUDED.embedding, updated_at = now()
            """
        )
        params = [
            (
                r["name"],
                r["alias"],
                r["description"],
                json.dumps(r["input_schema"]),
                r["content_hash"],
                json.dumps(r["embedding"]) if r["embedding"] else None,
            )
            for r in rows
        ]
        self._run(lambda c: c.cursor().executemany(statement, params))

    def count(self) -> int:
        query = _sql("SELECT count(*) FROM {tools}")
        return self._run(lambda c: c.execute(query).fetchone()[0])

    def rank(
        self, query: str, query_vec: list[float] | None, k: int, names: list[str]
    ) -> tuple[list[str], list[str]]:
        vector_sql = _sql(
            "SELECT name FROM {tools} "
            "WHERE embedding IS NOT NULL AND name = ANY(%s) "
            "ORDER BY embedding <=> %s::vector LIMIT %s"
        )
        # OR the terms: a natural-language query rarely contains every word of a
        # tool's text, so AND semantics (websearch_to_tsquery) would match almost nothing.
        keyword_sql = _sql(
            "SELECT name FROM {tools}, to_tsquery('english', %s) q "
            "WHERE tsv @@ q AND name = ANY(%s) ORDER BY ts_rank(tsv, q) DESC LIMIT %s"
        )
        terms = " | ".join(_query_terms(query))

        def go(conn):
            by_vector = []
            if query_vec is not None:
                rows = conn.execute(vector_sql, (names, json.dumps(query_vec), k)).fetchall()
                by_vector = [r[0] for r in rows]
            by_keyword = []
            if terms:
                rows = conn.execute(keyword_sql, (terms, names, k)).fetchall()
                by_keyword = [r[0] for r in rows]
            return by_vector, by_keyword

        return self._run(go)


class MemoryIndex:
    """Same contract as LakebaseIndex, held in process memory."""

    backend = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rows: dict[str, dict] = {}

    def hashes(self) -> dict[str, str]:
        with self._lock:
            return {name: row["content_hash"] for name, row in self._rows.items()}

    def upsert(self, rows: list[dict]) -> None:
        with self._lock:
            self._rows.update((row["name"], row) for row in rows)

    def count(self) -> int:
        return len(self._rows)

    def rank(
        self, query: str, query_vec: list[float] | None, k: int, names: list[str]
    ) -> tuple[list[str], list[str]]:
        allowed = set(names)
        with self._lock:
            rows = [row for name, row in self._rows.items() if name in allowed]
        by_vector = []
        if query_vec is not None:
            scored = [
                (_cosine(query_vec, r["embedding"]), r["name"]) for r in rows if r["embedding"]
            ]
            by_vector = [name for _, name in sorted(scored, reverse=True)[:k]]
        terms = {t for t in _query_terms(query) if len(t) > 2}
        scored = []
        for row in rows:
            words = re.findall(r"[a-z0-9]+", tool_text(row["name"], row["description"]).lower())
            hits = sum(words.count(t) for t in terms)
            if hits:
                scored.append((hits, row["name"]))
        by_keyword = [name for _, name in sorted(scored, reverse=True)[:k]]
        return by_vector, by_keyword


_index_lock = threading.Lock()
_index: LakebaseIndex | MemoryIndex | None = None
_index_error: str | None = None
_sync_lock = threading.Lock()
_last_sync_at = 0.0


def _get_index() -> LakebaseIndex | MemoryIndex:
    """The index backend, falling back to memory if Lakebase can't be set up (for
    example, the pgvector extension isn't installed)."""
    global _index, _index_error
    with _index_lock:
        if _index is not None:
            return _index
        if os.environ.get("PGHOST") and os.environ.get("PGENDPOINT"):
            lakebase = LakebaseIndex()
            try:
                lakebase.count()
                _index = lakebase
                return _index
            except (psycopg.Error, DatabricksError) as e:
                _index_error = f"Lakebase unavailable, using an in-memory index: {e}"
                log.error(_index_error)
        _index = MemoryIndex()
        return _index


def backend() -> str:
    """The active backend's name. No I/O once the backend is chosen."""
    return _index.backend if _index is not None else _get_index().backend


def status() -> dict:
    index = _get_index()
    return {
        "backend": index.backend,
        "backend_error": _index_error,
        "indexed": index.count(),
        "embedding_endpoint": embedding_endpoint(),
        "last_sync_age_s": round(time.time() - _last_sync_at, 1) if _last_sync_at else None,
    }


def count() -> int:
    return _get_index().count()


def sync(tools: list[dict]) -> dict:
    """Add or update the given {name, alias, description, input_schema} tools,
    re-embedding only those that changed. Never deletes: listings differ by caller,
    and search only ranks tools the caller can list right now, so a row for a tool
    that no longer exists is never returned."""
    global _last_sync_at
    index = _get_index()
    with _sync_lock:
        existing = index.hashes()
        changed = []
        for tool in tools:
            digest = _content_hash(tool)
            if existing.get(tool["name"]) != digest:
                changed.append({**tool, "content_hash": digest})
        if changed:
            try:
                vectors = embed([tool_text(t["name"], t["description"]) for t in changed])
            except (DatabricksError, KeyError, ValueError) as e:
                log.warning("embedding failed, indexing for keyword search only: %s", e)
                vectors = [None] * len(changed)
            for tool, vector in zip(changed, vectors, strict=True):
                tool["embedding"] = vector
            index.upsert(changed)
        _last_sync_at = time.time()
        return {"embedded": len(changed), "total": index.count()}


def search(query: str, top_n: int, names: list[str]) -> list[tuple[str, float]]:
    """The top_n of the given tool names for query, best first, as (name, score)."""
    try:
        query_vec = embed([query])[0]
    except (DatabricksError, KeyError, ValueError) as e:
        log.warning("query embedding failed, ranking by keyword only: %s", e)
        query_vec = None
    index = _get_index()
    by_vector, by_keyword = index.rank(query, query_vec, max(top_n * 4, 20), names)
    scores: dict[str, float] = {}
    for ranking in (by_vector, by_keyword):
        for rank, name in enumerate(ranking):
            scores[name] = scores.get(name, 0.0) + 1.0 / (_RRF_K + rank + 1)
    best = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    return [(name, round(score, 4)) for name, score in best]
