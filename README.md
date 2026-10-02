# NEXUS — Privacy-Preserving RAG

> A document-grounded Retrieval-Augmented Generation (RAG) application focused on protected embeddings, hybrid retrieval, cryptographic integrity verification, and fail-closed answer generation.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-NEXUS-blue?style=for-the-badge)](https://privacy-preserving-rag.ai.studio/)
[![GitHub](https://img.shields.io/badge/Source%20Code-GitHub-black?style=for-the-badge&logo=github)](https://github.com/jafersathikbace-cbe/privacy-preserving-rag)

---

## Overview

NEXUS is a document-grounded RAG application designed around **hybrid retrieval, protected embeddings, cryptographic integrity checks, and fail-closed generation**.

The system allows users to upload documents, retrieve relevant evidence, and generate answers grounded in verified document content rather than relying on unsupported model knowledge.

The design focuses on reducing unnecessary exposure of stored embedding representations while ensuring that retrieved evidence is integrity-checked before reaching the answer-generation stage.

---

## Key Features

- 📄 Uploads PDF, DOCX, TXT, and common image documents
- 🔎 Extracts document text with source and page metadata where available
- ✂️ Splits documents into overlapping chunks for retrieval continuity
- 🧠 Generates semantic embeddings using Gemini
- 🔐 Applies an orthogonal permutation/sign transformation to embeddings before storage and retrieval
- 🔍 Combines semantic similarity with lexical and phrase matching
- 🌐 Searches the complete indexed corpus during candidate ranking
- 🌳 Verifies retrieved chunks using SHA-256 Merkle proofs
- 🛡️ Allows only verified context to reach answer generation
- ✅ Uses a second factual verification pass
- 🚫 Refuses unsupported answers instead of filling gaps with model knowledge
- 📚 Supports multiple documents
- 📑 Displays source and page information for retrieved evidence
- 🗑️ Supports document deletion with automatic re-indexing
- 💬 Keeps conversation history separate from evidence
- 🔄 Uses conversation history only for reference resolution, never as proof

---

## How It Works

```text
                         NEXUS RAG PIPELINE

                         DOCUMENT INGESTION
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Document Extraction │
                    │ PDF / DOCX / TXT /   │
                    │ Images               │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Text + Page Metadata │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Overlapping Chunks    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Gemini Embeddings     │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Orthogonal Masking   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Vector Index +        │
                    │ Merkle Proofs         │
                    └──────────────────────┘


                           USER QUESTION
                                │
                                ▼
                    ┌──────────────────────┐
                    │ Gemini Query         │
                    │ Embedding            │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Same Embedding Mask  │
                    └──────────┬───────────┘
                               │
                               ▼
              ┌──────────────────────────────────┐
              │       Hybrid Retrieval           │
              │                                  │
              │  • Semantic similarity            │
              │  • Lexical matching               │
              │  • Phrase matching                │
              │  • Source diversity                │
              └───────────────┬──────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │ Merkle Verification  │
                    └──────────┬───────────┘
                               │
                         Verified Only
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Grounded Generation  │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Factual Verification │
                    └──────────┬───────────┘
                               │
                               ▼
                         Final Answer
