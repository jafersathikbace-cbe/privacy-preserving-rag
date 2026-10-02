# NEXUS — Privacy-Preserving RAG

NEXUS is a document-grounded RAG application designed around **hybrid retrieval, protected embeddings, cryptographic integrity checks, and fail-closed generation**.

## What it does

- Uploads PDF, DOCX, TXT and common image documents.
- Extracts text and keeps source/page metadata where available.
- Chunks documents with overlap for better retrieval continuity.
- Creates Gemini semantic embeddings and applies a secret orthogonal permutation/sign transform before storage and retrieval.
- Combines semantic similarity with lexical/phrase matching across the **entire indexed corpus**.
- Verifies every retrieved chunk against a SHA-256 Merkle proof before it reaches the answer model.
- Uses a strict grounded generation pass plus a second factual verification pass.
- Refuses unsupported answers instead of filling gaps with model knowledge.
- Supports multiple documents and shows the actual source and page for retrieved evidence.
- Supports document deletion with automatic re-indexing.
- Keeps conversation history separate from evidence; history can help resolve references but is never treated as proof.

## Retrieval design

```text
Documents
  -> extraction + page metadata
  -> overlapping chunks
  -> Gemini embeddings
  -> orthogonal masking
  -> in-memory vector index + Merkle proofs

Question
  -> Gemini query embedding + same mask
  -> global semantic scan
  -> lexical / phrase scoring
  -> hybrid ranking + source diversity
  -> Merkle verification
  -> verified context only
  -> grounded answer
  -> second-pass factual verification
```

The important design choice is that retrieval is **not restricted to a small set of clusters**. Clustering is still calculated as an index characteristic, but candidate ranking searches the complete corpus so a relevant chunk in another document cannot be hidden by an incorrect coarse cluster selection.

## Configuration

See `.env.example`. `GEMINI_API_KEY` must be supplied as a server-side secret and must never be committed to Git.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Important deployment note

The current implementation stores uploaded documents and the active index on the application's local filesystem. This is suitable for a prototype/demo but **local Cloud Run/container storage is not durable application storage**. For a production multi-instance deployment, move documents/index state to durable storage such as object storage plus a managed vector/index store.

## Security note

Orthogonal masking changes the representation of stored embeddings while preserving cosine/dot-product geometry. It is a privacy-oriented design feature, not a formal guarantee of end-to-end confidentiality. API keys and durable document storage still require appropriate platform controls.
