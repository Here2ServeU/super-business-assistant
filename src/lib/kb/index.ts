import { createHash } from "node:crypto";
import type { Source, TenantDb } from "@/lib/dal";
import { guard } from "@/lib/guard";

// The Cabinet: each tenant's private knowledge base.
// Embeddings are a local, deterministic feature-hashing model (256 dims): no
// provider key, no per-call cost, and nothing leaves the server. The vector
// column is pgvector, so a hosted embedding model can be swapped in later by
// changing embed() and re-ingesting.

export const DIMS = 256;

const STOP = new Set("a an the and or of to in on for with at by from is are was were be been it this that these those i you we they he she our your their my me us do does did can could would should will shall may might have has had not no yes if then than so as about what when where which who how".split(" "));

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9$]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function bucket(s: string): [number, number] {
  const h = createHash("md5").update(s).digest();
  return [h.readUInt32LE(0) % DIMS, h[4] & 1 ? 1 : -1];
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    const [b, sign] = bucket(toks[i]);
    v[b] += sign;
    if (i + 1 < toks.length) {
      const [b2, s2] = bucket(`${toks[i]}_${toks[i + 1]}`);
      v[b2] += 0.5 * s2;
    }
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function chunk(content: string, maxChars = 700): string[] {
  const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      out.push(cur);
      cur = "";
    }
    if (p.length > maxChars) {
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        if (cur && cur.length + s.length + 1 > maxChars) {
          out.push(cur);
          cur = "";
        }
        cur = cur ? `${cur} ${s}` : s;
      }
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Add a document to the tenant's cabinet. Content is guarded before storage. */
export async function ingestDocument(db: TenantDb, title: string, content: string, actor = "system") {
  const g = guard(content);
  const docId = await db.insertDocument(title.slice(0, 200), g.text);
  const pieces = chunk(g.text);
  await db.insertChunks(docId, pieces.map((c, i) => ({ ordinal: i, content: c, embedding: embed(`${title}\n${c}`) })));
  await db.audit(actor, "kb_ingest", docId, `"${title}" (${pieces.length} chunks${g.count ? `, ${g.count} sensitive value(s) masked` : ""})`);
  return docId;
}

export interface Retrieved extends Source {
  similarity: number;
  content: string;
}

/** Retrieve the most relevant cabinet passages for a question. Tenant-scoped by the DAL. */
export async function retrieve(db: TenantDb, query: string, k = 4, minSimilarity = 0.04): Promise<Retrieved[]> {
  const rows = await db.searchChunks(embed(query), k);
  return rows
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      title: r.title,
      excerpt: r.content.slice(0, 280),
      content: r.content,
      similarity: Number(r.similarity),
    }));
}
