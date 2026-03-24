import { PROVIDERS } from './llmProviders';
import { isModelAccessError, toFriendlyMessage } from './llmErrors';

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

export async function convertToBibtex(input, provider = 'gemini', apiKeys = {}) {
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

    let lastError = null;

    for (const model of config.models) {
        try {
            let result;
            if (config.type === 'gemini') {
                result = await callGeminiModel(trimmedInput, model, apiKey);
            } else {
                result = await callOpenAICompatModel(config.baseURL, model, apiKey, trimmedInput);
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
            // Key error / rate limit / balance / network → stop immediately
            if (e.status === 401 || e.status === 429 || e.status === 402 || !e.status) {
                throw new Error(toFriendlyMessage(e, providerName));
            }
            // Model access error → try next model
            if (isModelAccessError(e.status, e.message)) {
                lastError = e;
                continue;
            }
            // Other errors → stop
            throw new Error(toFriendlyMessage(e, providerName));
        }
    }

    // All models exhausted
    throw new Error(toFriendlyMessage(lastError, providerName, true));
}
