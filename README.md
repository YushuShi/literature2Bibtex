# Literature → BibTeX

A web application that converts academic citations from any format into validated BibTeX entries. It uses an LLM to parse citations, then cross-checks the extracted metadata against multiple academic databases to **detect and correct hallucinations**.

## Features

### Citation Parsing
- Paste citations in any format: full-text references, DOIs, PubMed IDs, URLs, or arXiv/bioRxiv/SSRN preprint identifiers
- The LLM extracts structured metadata (title, authors, journal, year, volume, pages, DOI, PMID) and generates a BibTeX entry

### Hallucination Detection & Auto-Correction
Each citation is validated against live academic databases. Detected mismatches are automatically corrected and highlighted.

| Status | Color | Meaning |
|--------|-------|---------|
| Valid | Black | All fields match the database record |
| Auto-Corrected | Orange | Hallucinated fields found and fixed |
| Not Found | Red | Could not be verified in any database |
| Out-dated | Grey | Pre-1970 publication, skipped (not in modern databases) |

Validation handles common edge cases:
- **Abbreviated page ranges** — `577-80` is treated as `577-580`
- **Author format differences** — abbreviated vs. full given names
- **Journal name variants** — `&` vs. `and`, historical name changes
- **Year tolerance** — ±1 year for online-first vs. print publication dates

### Multi-Source Verification

Citations go through a cascading verification strategy:

1. **Direct ID lookup** — CrossRef (DOI), NCBI PubMed (PMID), Scopus
2. **Title search** — NCBI, Scopus, CrossRef, Semantic Scholar
3. **Preprint detection** — arXiv, bioRxiv/medRxiv, SSRN
4. **Same-title disambiguation** — deep search with year/author filters when a title matches a different paper

### Export Formats

**Citation styles:**

| Style | Description |
|-------|-------------|
| BibTeX | Standard LaTeX format |
| APA 7th | American Psychological Association |
| MLA 9th | Modern Language Association |
| IEEE | Institute of Electrical and Electronics Engineers |
| Chicago 17th | Notes-Bibliography style |
| Vancouver | Medical / biomedical journals |
| AMA 11th | American Medical Association |
| AMJ | Academy of Management Journal |
| ACS | American Chemical Society |
| Harvard Gatton | Business / economics |

**File downloads:** `.bib` (BibTeX) · `.ris` (universal) · `.nbib` (PubMed)

---

## Supported LLM Providers

| Provider | Models (with auto-fallback) | Custom Base URI |
|----------|-----------------------------|-----------------|
| **Gemini** | gemini-2.5-pro → gemini-1.5-pro → gemini-1.5-flash | No |
| **OpenAI** | gpt-4o → gpt-4o-mini | Yes |
| **Qwen** | qwen-plus → qwen-turbo | Yes |
| **DeepSeek** | deepseek-chat → deepseek-reasoner | Yes |

If a model is unavailable (e.g., no access permission), the app automatically tries the next model in the chain. Auth errors, rate limits, and balance issues stop immediately without retrying.

Custom Base URI lets you point OpenAI-compatible providers to a proxy or self-hosted endpoint.

---

## Getting Started

### Prerequisites
- Node.js 18+

### Installation

```bash
git clone https://github.com/Yoz234/literature2Bibtex2026.git
cd literature2Bibtex2026
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### API Keys

Click the **API Keys** button in the top-right corner to enter your credentials. Keys are saved in your browser's localStorage and never sent anywhere except the respective API endpoints.

| Key | Required | Purpose |
|-----|----------|---------|
| Gemini / OpenAI / Qwen / DeepSeek | Yes (one of them) | Citation parsing via LLM |
| NCBI API Key | Optional | Higher rate limit for PubMed lookups |
| Elsevier API Key | Optional | Enables Scopus validation |

---

## How It Works

```
User input (any citation format)
        │
        ▼
[LLM parsing]  →  Structured metadata + initial BibTeX
        │
        ▼
[Multi-source validation]
  ├─ Strategy A: Direct ID lookup (CrossRef / NCBI / Scopus)
  ├─ Strategy B: Title search (NCBI / Scopus / CrossRef / Semantic Scholar)
  └─ Strategy C: Preprint detection (arXiv / bioRxiv / SSRN)
        │
        ▼
Results: status + corrected BibTeX + mismatch details
        │
        ▼
Export in any of 10 citation styles or 3 file formats
```

---

## Tech Stack

- **React 19** + **Vite 7** + **Tailwind CSS 3**
- **citation-js** — parses DOIs/PMIDs/URLs into BibTeX
- **lucide-react** — icons

---

## License

MIT
