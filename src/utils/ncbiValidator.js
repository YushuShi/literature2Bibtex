export async function validateCitations(citations) {
    const apiKey = import.meta.env.VITE_NCBI_API_KEY;
    const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';

    // Helper to wait to avoid rate limits (3 requests/sec without key, 10/sec with key)
    // We'll be conservative.
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const validatedResults = [];

    for (const item of citations) {
        let isValid = false;
        let searchTerm = '';

        // 1. Try identifiers first
        if (item.doi) {
            searchTerm = `${item.doi}[Location ID] OR ${item.doi}[DOI]`;
        } else if (item.pmid) {
            searchTerm = `${item.pmid}[uid]`;
        } else if (item.pmcid) {
            searchTerm = `${item.pmcid}`;
        } else {
            // 2. Fallback to Title
            // Clean title: remove quotes, braces
            const cleanedTitle = item.title?.replace(/[{}]/g, '').replace(/['"]/g, '');
            if (cleanedTitle) {
                searchTerm = `${cleanedTitle}[Title]`;
            }
        }

        if (searchTerm) {
            try {
                const params = new URLSearchParams({
                    db: 'pubmed',
                    term: searchTerm,
                    retmode: 'json',
                });

                if (apiKey) {
                    params.append('api_key', apiKey);
                }

                const response = await fetch(`${BASE_URL}?${params.toString()}`);
                if (response.ok) {
                    const data = await response.json();
                    // If count > 0, we found it
                    if (data.esearchresult && parseInt(data.esearchresult.count) > 0) {
                        isValid = true;
                    }
                }
            } catch (e) {
                console.warn("NCBI Validation failed for item:", item, e);
                // Fallback: if API fails, we don't mark it invalid definitively, but for this requirement
                // "If nothing found... make text red", we assume invalid.
                isValid = false;
            }
        }

        validatedResults.push({
            ...item,
            isValid
        });

        // Rate limit delay
        await delay(apiKey ? 150 : 400);
    }

    return validatedResults;
}
