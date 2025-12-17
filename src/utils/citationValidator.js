import Cite from 'citation-js';

// Comprehensive citation validator checking details (Authors, Year, Vol, Pages)

export async function validateCitations(citations) {
    const ncbiKey = import.meta.env.VITE_NCBI_API_KEY;
    const elsevierKey = import.meta.env.VITE_ELSEVIER_API_KEY;

    const NCBI_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
    const SCOPUS_URL = 'https://api.elsevier.com/content/search/scopus';

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const validatedResults = [];

    for (const item of citations) {
        let status = 'invalid'; // 'valid' | 'invalid' | 'corrected'
        let sources = []; // ['NCBI', 'Scopus']
        let trueData = null; // { title, authors: [], journal, year, volume, pages, doi, pmid }
        let correctedBibtex = null;
        let mismatchDetails = [];

        // --- 1. RESOLUTION PHASE: Try to get True Metadata ---
        let idType = null;
        let idValue = null;

        if (item.doi) { idType = 'doi'; idValue = item.doi; }
        else if (item.pmid) { idType = 'pmid'; idValue = item.pmid; }
        else if (item.pmcid) { idType = 'pmcid'; idValue = item.pmcid; }

        // A. STRATEGY 1: Resolve by Provided ID
        if (idValue) {
            try {
                const cite = await Cite.async(idValue);
                const data = cite.data[0];
                if (data) {
                    trueData = {
                        title: data.title,
                        journal: data['container-title'],
                        authors: data.author ? data.author.map(a => `${a.given || ''} ${a.family || ''}`.trim()) : [],
                        year: data.issued?.['date-parts']?.[0]?.[0]?.toString(),
                        volume: data.volume?.toString(),
                        pages: data.page?.toString(),
                        doi: data.DOI || idValue
                    };
                    status = 'valid';
                    if (sources.length === 0) sources.push("CrossRef/Ref");
                    correctedBibtex = cite.format('bibtex', { format: 'text' });
                }
            } catch (e) {
                console.warn("Checking provided ID failed, falling back to Title Search", e);
                idValue = null; // Reset to trigger title search
            }
        }

        // B. STRATEGY 2: Search by Title (Fallback if ID missing or invalid)
        if (!trueData) {
            const cleanedTitle = item.title?.replace(/[{}]/g, '').replace(/['"]/g, '').replace(/[.,]$/, '').trim();

            if (cleanedTitle) {
                let foundId = null;
                let foundSource = null;

                // 1. NCBI Search
                try {
                    // Search by Title
                    const params = new URLSearchParams({ db: 'pubmed', term: `${cleanedTitle}[Title]`, retmode: 'json' });
                    if (ncbiKey) params.append('api_key', ncbiKey);
                    const res = await fetch(`${NCBI_URL}?${params.toString()}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.esearchresult?.count > 0) {
                            foundId = data.esearchresult.idlist[0];
                            foundSource = 'NCBI';
                        }
                    }
                } catch (e) {/*ignore*/ }

                // 2. Scopus Search (if not found in NCBI)
                if (!foundId && elsevierKey) {
                    try {
                        // Search Top 5 for Exact Title Match
                        const res = await fetch(`${SCOPUS_URL}?query=TITLE("${encodeURIComponent(cleanedTitle)}")&count=5`, {
                            headers: { 'X-ELS-APIKey': elsevierKey, 'Accept': 'application/json' }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const total = parseInt(data['search-results']?.['opensearch:totalResults']);
                            if (total > 0) {
                                const entries = data['search-results'].entry;
                                // Find exact title match
                                const exactMatch = entries.find(e => normalize(e['dc:title']) === normalize(cleanedTitle));
                                const result = exactMatch || entries[0]; // Prefer exact

                                if (result) {
                                    foundSource = 'Scopus';
                                    if (result['prism:doi']) foundId = result['prism:doi'];
                                    // If Scopus found it but no DOI, we typically can't use citation-js well. 
                                    // But we can construct partial trueData from Scopus result directly?
                                    // For consistency, let's try to get an ID. 
                                    // If no DOI, we might need to rely on Scopus metadata directly.
                                    if (!foundId) {
                                        // Construct TrueData directly from Scopus result
                                        trueData = {
                                            title: result['dc:title'],
                                            journal: result['prism:publicationName'],
                                            authors: [result['dc:creator']], // Scopus often only gives first author or creator string
                                            year: result['prism:coverDate']?.substring(0, 4),
                                            volume: result['prism:volume'],
                                            pages: result['prism:pageRange'],
                                            doi: null
                                        };
                                        status = 'valid';
                                        sources.push('Scopus');
                                    }
                                }
                            }
                        }
                    } catch (e) {/*ignore*/ }
                }

                // 3. Resolve Found ID
                if (foundId && !trueData) { // Only resolve if an ID was found and trueData wasn't already set by Scopus
                    try {
                        const cite = await Cite.async(foundId);
                        const data = cite.data[0];
                        if (data) {
                            trueData = {
                                title: data.title,
                                journal: data['container-title'],
                                authors: data.author ? data.author.map(a => `${a.given || ''} ${a.family || ''}`.trim()) : [],
                                year: data.issued?.['date-parts']?.[0]?.[0]?.toString(),
                                volume: data.volume?.toString(),
                                pages: data.page?.toString(),
                                doi: data.DOI || foundId
                            };
                            status = 'valid';
                            sources.push(foundSource);
                            // Helper: updated bibtex from this true data
                            correctedBibtex = cite.format('bibtex', { format: 'text' });
                        }
                    } catch (e) { console.warn("Fetch failed for found ID", e); }
                }
            }
        }

        // --- 3. COMPARE PHASE: Hallucination Check (Details) ---
        if (trueData) {
            let isHallucinated = false;

            // Helper to compare fields
            const checkMismatch = (extracted, distinctTrue, label) => {
                if (extracted && distinctTrue && normalize(extracted) !== normalize(distinctTrue)) {
                    // Fuzzy check: sometimes volume is "45" vs "45(2)" or pages "123-145" vs "123"
                    if (!distinctTrue.includes(extracted) && !extracted.includes(distinctTrue)) {
                        isHallucinated = true;
                        mismatchDetails.push(`${label}: "${extracted}" vs "${distinctTrue}"`);
                    }
                }
            };

            // 1. Journal
            const genJournal = normalize(item.extracted_journal);
            const refJournal = normalize(trueData.journal);
            if (genJournal && refJournal && !stringsMatch(genJournal, refJournal)) {
                isHallucinated = true;
                mismatchDetails.push(`Journal: "${item.extracted_journal}" vs "${trueData.journal}"`);
            }

            // 2. Authors
            const genAuthors = (item.extracted_authors || []).map(normalize);
            const refAuthors = (trueData.authors || []).map(normalize);
            if (genAuthors.length > 0 && refAuthors.length > 0) {
                if (!stringsMatch(genAuthors[0], refAuthors[0]) && !refAuthors.some(ra => stringsMatch(genAuthors[0], ra))) {
                    isHallucinated = true;
                    mismatchDetails.push(`Authors mismatch.`);
                }
            }

            // 3. Year
            checkMismatch(item.extracted_year, trueData.year, "Year");

            // 4. Volume
            checkMismatch(item.extracted_volume, trueData.volume, "Volume");

            // 5. Pages
            checkMismatch(item.extracted_pages, trueData.pages, "Pages");

            if (isHallucinated) {
                status = 'corrected';
            }
        }

        validatedResults.push({
            ...item,
            status, // 'valid', 'corrected', 'invalid'
            sources,
            bibtex: (status === 'corrected' && correctedBibtex) ? correctedBibtex : item.bibtex,
            mismatchDetails
        });

        await delay(200);
    }

    return validatedResults;
}

function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringsMatch(s1, s2) {
    if (!s1 || !s2) return false;
    return s1.includes(s2) || s2.includes(s1);
}
