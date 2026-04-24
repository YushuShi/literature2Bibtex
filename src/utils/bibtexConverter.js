import { PROVIDERS, MODEL_ALIASES } from './llmProviders';
import { isModelAccessError, isModelNameError, toFriendlyMessage } from './llmErrors';

const PROMPT = (trimmedInput) => `You are a citation parser. Parse the input into structured citation data.

INPUT TYPE DETECTION:
- STANDALONE URL/DOI: input is only a URL or DOI with no author/title/year visible.
  → Extract the identifier (doi or pmid) only. Set all extracted_* fields to null.
- TEXT CITATION: input contains author, title, year, or other bibliographic fields.
  → Extract all fields explicitly visible in the text. Set null for fields not present.

CRITICAL: Respond with a JSON object containing a "citations" key with an array. Never return a plain string or bare array. All scalar fields must be strings or null, never arrays.

Required format:
{"citations": [
  {
    "original": "exact input text for this citation (REQUIRED, never empty)",
    "bibtex": "full BibTeX entry string",
    "title": "paper title, or null if not visible in input",
    "doi": "DOI string only e.g. 10.1234/xyz (no URL prefix), or null",
    "pmid": "PubMed ID number only, or null",
    "extracted_journal": "journal name, or null if not visible",
    "extracted_authors": ["Author1", "Author2"],
    "extracted_year": "year string, or null if not visible",
    "extracted_volume": "volume, or null if not visible",
    "extracted_pages": "page range, or null if not visible"
  }
]}

<citation_text>
${trimmedInput}
</citation_text>`;

async function callGeminiModel(trimmedInput, model, apiKey) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: PROMPT(trimmedInput) }] }],
                generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
            })
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error?.message || `API Error: ${response.status}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    let content = data.candidates[0].content.parts[0].text;
    content = content.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '');
    const parsed = JSON.parse(content);
    return parsed.citations ?? (Array.isArray(parsed) ? parsed : null);
}

async function callOpenAICompatModel(baseURL, model, apiKey, trimmedInput) {
    const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: PROMPT(trimmedInput) }],
            response_format: { type: 'json_object' },
            temperature: 0.2
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error?.message || `API Error: ${response.status}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return parsed.citations ?? (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);
}

// Split raw text into individual citation strings
function splitCitations(text) {
    // Strategy 1a: bracketed numbers [N] or (N) — brackets required, avoids DOI fragments
    const byBracket = text.split(/(?=^\s*[\[\(]\d{1,3}[\]\)]\s)/m).map(s => s.trim()).filter(Boolean);
    if (byBracket.length > 1) return byBracket;
    // Strategy 1b: N. format — require space + capital after dot to exclude DOI continuations
    const byDotNumber = text.split(/(?=^\s*\d+\.\s+[A-Z])/m).map(s => s.trim()).filter(Boolean);
    if (byDotNumber.length > 1) return byDotNumber;
    // Strategy 2: paragraph-separated (single or double blank line)
    const byParagraph = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (byParagraph.length > 1) return byParagraph;
    // Strategy 3: one citation per line
    return text.split('\n').map(s => s.trim()).filter(Boolean);
}

const CHUNK_SIZE = 16;

// Core LLM call with model fallback and alias retry (single chunk)
async function callLLMWithFallback(chunkText, config, providerName, apiKey, apiKeys, provider) {
    let lastError = null;

    for (const model of config.models) {
        const variants = [model, ...(MODEL_ALIASES[model] || [])];
        let modelNameFailed = false;

        for (const variant of variants) {
            try {
                let result;
                if (config.type === 'gemini') {
                    result = await callGeminiModel(chunkText, variant, apiKey);
                } else {
                    const baseURL = (apiKeys[`${provider}_baseuri`]?.trim() || config.baseURL).replace(/\/$/, '');
                    result = await callOpenAICompatModel(baseURL, variant, apiKey, chunkText);
                }

                // Safety net: if LLM still returns a string
                if (typeof result === 'string') {
                    return [{
                        original: result, bibtex: '', title: null, doi: null, pmid: null,
                        extracted_journal: null, extracted_authors: [],
                        extracted_year: null, extracted_volume: null, extracted_pages: null
                    }];
                }
                return result;

            } catch (e) {
                // Model name format error → try next alias
                if (isModelNameError(e.status, e.message)) {
                    lastError = e;
                    modelNameFailed = true;
                    continue;
                }
                // Key error / rate limit / balance / network → stop immediately
                if (e.status === 401 || e.status === 429 || e.status === 402 || !e.status) {
                    throw new Error(toFriendlyMessage(e, providerName));
                }
                // Model access error → stop alias loop, try next fallback model
                if (isModelAccessError(e.status, e.message)) {
                    lastError = e;
                    break;
                }
                // Other errors → stop
                throw new Error(toFriendlyMessage(e, providerName));
            }
        }

        // If all aliases exhausted due to model name errors, try next fallback model
        if (modelNameFailed) continue;
    }

    // All models exhausted
    throw new Error(toFriendlyMessage(lastError, providerName, true));
}

export async function convertToBibtex(input, provider = 'gemini', apiKeys = {}, onProgress) {
    const trimmedInput = input.trim();
    if (!trimmedInput) return null;

    const config = PROVIDERS[provider];
    const providerName = config.name;
    const apiKey = apiKeys[provider];

    if (!apiKey) {
        const err = new Error();
        err.type = 'key_missing';
        throw new Error(toFriendlyMessage(err, providerName));
    }

    const citations = splitCitations(trimmedInput);

    if (citations.length <= CHUNK_SIZE) {
        // Small input: single call
        const items = await callLLMWithFallback(trimmedInput, config, providerName, apiKey, apiKeys, provider);
        return { citations: items, truncated: false };
    }

    // Large input: chunked calls
    const results = [];
    let truncated = false;
    for (let i = 0; i < citations.length; i += CHUNK_SIZE) {
        onProgress?.(i, citations.length);
        const slice = citations.slice(i, i + CHUNK_SIZE);
        const chunk = slice.join('\n\n');
        const items = await callLLMWithFallback(chunk, config, providerName, apiKey, apiKeys, provider);
        if (items) {
            if (items.length < slice.length) truncated = true;
            results.push(...items);
        }
    }
    return { citations: results, truncated };
}
