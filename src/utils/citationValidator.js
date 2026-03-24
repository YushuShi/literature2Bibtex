import Cite from 'citation-js';
import { deepSearchByTitle } from './deepSearch';

// Comprehensive citation validator checking details (Authors, Year, Vol, Pages)

// Safety: LLM may return arrays instead of strings for any field
const toStr = v => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

export async function validateCitations(citations, apiKeys = {}) {
    const ncbiKey = apiKeys.ncbi;
    const elsevierKey = apiKeys.elsevier;

    const NCBI_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
    const SCOPUS_URL = 'https://api.elsevier.com/content/search/scopus';

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const TITLE_SIM_THRESHOLD = 0.85;

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
        let foundViaId = false;

        if (item.doi) { idType = 'doi'; idValue = item.doi; }
        else if (item.pmid) { idType = 'pmid'; idValue = item.pmid; }
        else if (item.pmcid) { idType = 'pmcid'; idValue = item.pmcid; }
        else if (item.original?.startsWith('http')) { idType = 'url'; idValue = item.original; }


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
                        issue: data.issue?.toString(),
                        pages: data.page?.toString(),
                        doi: data.DOI || idValue
                    };
                    status = 'valid';
                    foundViaId = true;
                    if (sources.length === 0) sources.push("CrossRef/Ref");
                    correctedBibtex = cite.format('bibtex', { format: 'text' });
                }
            } catch (e) {
                console.warn(`[Strategy A] Cite.async failed for "${idValue}":`, e.message);
                // Fallback: NCBI esummary for PubMed URLs
                const pmidFromUrl = idValue?.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1];
                if (pmidFromUrl) {
                    try {
                        const params = new URLSearchParams({ db: 'pubmed', id: pmidFromUrl, retmode: 'json' });
                        if (ncbiKey) params.append('api_key', ncbiKey);
                        const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`);
                        if (res.ok) {
                            const ncbiData = await res.json();
                            const r = ncbiData.result?.[pmidFromUrl];
                            if (r && !r.error && r.title) {
                                const doi = r.elocationid?.replace('doi: ', '').trim() || null;
                                trueData = {
                                    title: r.title,
                                    journal: r.fulljournalname || r.source,
                                    authors: (r.authors || []).map(a => a.name),
                                    year: r.pubdate?.split(' ')?.[0],
                                    volume: r.volume,
                                    issue: r.issue,
                                    pages: r.pages,
                                    doi
                                };
                                status = 'valid';
                                foundViaId = true;
                                sources.push('NCBI');
                                const authorKey = trueData.authors[0]?.split(' ').pop() || 'unknown';
                                const citeKey = `${authorKey}${trueData.year || ''}`;
                                correctedBibtex = `@article{${citeKey},\n  author = {${trueData.authors.join(' and ')}},\n  title = {${trueData.title}},\n  journal = {${trueData.journal}},\n  year = {${trueData.year || ''}},\n  volume = {${trueData.volume || ''}},\n  pages = {${trueData.pages || ''}}${doi ? `,\n  doi = {${doi}}` : ''}\n}`;
                            }
                        }
                    } catch (e2) {
                        console.warn('[Strategy A NCBI fallback] failed:', e2.message);
                    }
                }
                if (!trueData) idValue = null;
            }
        }

        // A-check. URL MISMATCH DETECTION: if resolved title doesn't match extracted title,
        // the URL/DOI likely points to the wrong article — discard and fall through to title search
        if (trueData && item.title) {
            const sim = titleSimilarity(item.title, trueData.title || '');
            if (sim < 0.5) {
                console.warn('[URL mismatch] title sim:', sim.toFixed(2), '| extracted:', item.title, '| resolved:', trueData.title);
                mismatchDetails.push(`URL points to wrong article: resolved "${trueData.title}"`);
                trueData = null;
                correctedBibtex = null;
                status = 'invalid';
            }
        }

        // B. STRATEGY 2: Search by Title (Fallback if ID missing or invalid)
        if (!trueData) {
            const cleanedTitle = toStr(item.title).replace(/[{}]/g, '').replace(/['"]/g, '').replace(/[.,]$/, '').trim();

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
                                // Find best title match using fuzzy similarity
                                let bestSC = null, bestSCSim = 0;
                                for (const e of entries) {
                                    const sim = titleSimilarity(e['dc:title'], cleanedTitle);
                                    if (sim > bestSCSim) { bestSCSim = sim; bestSC = e; }
                                }
                                const result = bestSCSim >= TITLE_SIM_THRESHOLD ? bestSC : null;

                                if (result) {
                                    foundSource = 'Scopus';
                                    if (result['prism:doi']) foundId = result['prism:doi'];
                                    // If Scopus found it but no DOI, we typically can't use citation-js well.
                                    // But we can construct partial trueData from Scopus result directly?
                                    // For consistency, let's try to get an ID.
                                    // If no DOI, we might need to rely on Scopus metadata directly.
                                    if (!foundId) {
                                        // Construct TrueData directly from Scopus result
                                        const scopusAuthors = result['dc:creator'] ? [result['dc:creator']] : [];
                                        const scopusYear = result['prism:coverDate']?.substring(0, 4);
                                        trueData = {
                                            title: result['dc:title'],
                                            journal: result['prism:publicationName'],
                                            authors: scopusAuthors,
                                            year: scopusYear,
                                            volume: result['prism:volume'],
                                            issue: result['prism:issueIdentifier'],
                                            pages: result['prism:pageRange'],
                                            doi: null
                                        };
                                        status = 'valid';
                                        sources.push('Scopus');
                                        const authorKey = scopusAuthors[0]?.split(' ').pop() || 'unknown';
                                        const citeKey = `${authorKey}${scopusYear || ''}`;
                                        correctedBibtex = `@article{${citeKey},\n  author = {${scopusAuthors.join(' and ')}},\n  title = {${trueData.title || ''}},\n  journal = {${trueData.journal || ''}},\n  year = {${scopusYear || ''}},\n  volume = {${trueData.volume || ''}},\n  pages = {${trueData.pages || ''}}\n}`;
                                    }
                                }
                            }
                        }
                    } catch (e) {/*ignore*/ }
                }

                // 3. CrossRef Title Search (free, no key needed — covers CS/engineering/social science)
                if (!foundId && !trueData) {
                    try {
                        const res = await fetch(
                            `https://api.crossref.org/works?query.title=${encodeURIComponent(cleanedTitle)}&rows=10&select=DOI,title`
                        );
                        if (res.ok) {
                            const data = await res.json();
                            const items = data.message?.items || [];
                            let bestCR = null, bestCRSim = 0;
                            for (const it of items) {
                                const sim = titleSimilarity(it.title?.[0], cleanedTitle);
                                if (sim > bestCRSim) { bestCRSim = sim; bestCR = it; }
                            }
                            if (bestCRSim >= TITLE_SIM_THRESHOLD && bestCR?.DOI) {
                                foundId = bestCR.DOI;
                                foundSource = 'CrossRef';
                            }
                        }
                    } catch (e) { console.warn('[CrossRef] failed:', e); }
                }

                // 4. Semantic Scholar Title Search (CORS-enabled; indexes arXiv + CS papers)
                if (!foundId && !trueData) {
                    try {
                        const ssRes = await fetch(
                            `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(cleanedTitle)}&fields=title,authors,year,externalIds,venue&limit=5`
                        );
                        if (ssRes.ok) {
                            const ssData = await ssRes.json();
                            const papers = ssData.data || [];
                            let bestPaper = null, bestSim = 0;
                            for (const p of papers) {
                                const sim = titleSimilarity(p.title, cleanedTitle);
                                if (sim > bestSim) { bestSim = sim; bestPaper = p; }
                            }
                            if (bestSim >= TITLE_SIM_THRESHOLD && bestPaper) {
                                const arxivId = bestPaper.externalIds?.ArXiv || null;
                                const doi = bestPaper.externalIds?.DOI || (arxivId ? `10.48550/arXiv.${arxivId}` : null);
                                const authors = (bestPaper.authors || []).map(a => a.name);
                                const year = bestPaper.year?.toString();
                                const title = bestPaper.title;
                                const venue = bestPaper.venue || (arxivId ? 'arXiv' : null);
                                trueData = { title, journal: venue, authors, year, volume: null, issue: null, pages: null, doi };
                                status = 'valid';
                                sources.push(arxivId ? 'arXiv' : 'Semantic Scholar');
                                const authorKey = authors[0]?.split(/[,\s]+/)?.pop() || 'unknown';
                                if (arxivId) {
                                    correctedBibtex = `@misc{${authorKey}${year || ''},\n  author = {${authors.join(' and ')}},\n  title = {${title || ''}},\n  year = {${year || ''}},\n  eprint = {${arxivId}},\n  archivePrefix = {arXiv}${doi ? `,\n  doi = {${doi}}` : ''}\n}`;
                                } else {
                                    correctedBibtex = `@article{${authorKey}${year || ''},\n  author = {${authors.join(' and ')}},\n  title = {${title || ''}},\n  journal = {${venue || ''}},\n  year = {${year || ''}}${doi ? `,\n  doi = {${doi}}` : ''}\n}`;
                                }
                            }
                        }
                    } catch (e) { console.warn('[Semantic Scholar] failed:', e.message); }
                }

                // 5. Resolve Found ID
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
                                issue: data.issue?.toString(),
                                pages: data.page?.toString(),
                                doi: data.DOI || foundId
                            };
                            status = 'valid';
                            sources.push(foundSource);
                            correctedBibtex = cite.format('bibtex', { format: 'text' });
                        }
                    } catch (e) {
                        console.warn("Cite.async failed:", e.message, "| foundId:", foundId);
                        // Fallback A: NCBI esummary for bare PMIDs (numeric strings)
                        if (typeof foundId === 'string' && /^\d+$/.test(foundId)) {
                            try {
                                const params = new URLSearchParams({ db: 'pubmed', id: foundId, retmode: 'json' });
                                if (ncbiKey) params.append('api_key', ncbiKey);
                                const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`);
                                if (res.ok) {
                                    const ncbiData = await res.json();
                                    const r = ncbiData.result?.[foundId];
                                    if (r && !r.error && r.title) {
                                        const doi = r.elocationid?.replace('doi: ', '').trim() || null;
                                        const authors = (r.authors || []).map(a => a.name);
                                        const year = r.pubdate?.split(' ')?.[0];
                                        trueData = {
                                            title: r.title,
                                            journal: r.fulljournalname || r.source,
                                            authors, year,
                                            volume: r.volume,
                                            issue: r.issue,
                                            pages: r.pages,
                                            doi
                                        };
                                        status = 'valid';
                                        sources.push('NCBI');
                                        const authorKey = authors[0]?.split(' ').pop() || 'unknown';
                                        correctedBibtex = `@article{${authorKey}${year || ''},\n  author = {${authors.join(' and ')}},\n  title = {${trueData.title}},\n  journal = {${trueData.journal || ''}},\n  year = {${year || ''}},\n  volume = {${trueData.volume || ''}},\n  pages = {${trueData.pages || ''}}${doi ? `,\n  doi = {${doi}}` : ''}\n}`;
                                    }
                                }
                            } catch (e2) { console.warn('[NCBI esummary fallback] failed:', e2.message); }
                        }
                        // Fallback B: CrossRef direct API for DOIs (bypasses citation-js)
                        if (!trueData && typeof foundId === 'string' && foundId.startsWith('10.')) {
                            try {
                                // DOI slashes must NOT be percent-encoded in the URL path
                                const crRes = await fetch(`https://api.crossref.org/works/${foundId}`);
                                if (crRes.ok) {
                                    const crJson = await crRes.json();
                                    const w = crJson.message;
                                    if (w?.title?.[0]) {
                                        const authors = (w.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim());
                                        const year = w.issued?.['date-parts']?.[0]?.[0]?.toString()
                                            || w['published-online']?.['date-parts']?.[0]?.[0]?.toString();
                                        trueData = {
                                            title: w.title[0],
                                            journal: w['container-title']?.[0],
                                            authors,
                                            year,
                                            volume: w.volume?.toString(),
                                            issue: w.issue?.toString(),
                                            pages: w.page?.toString(),
                                            doi: w.DOI
                                        };
                                        status = 'valid';
                                        sources.push(foundSource || 'CrossRef');
                                        const authorKey = authors[0]?.split(' ').pop() || 'unknown';
                                        correctedBibtex = `@article{${authorKey}${year || ''},\n  author = {${authors.join(' and ')}},\n  title = {${trueData.title}},\n  journal = {${trueData.journal || ''}},\n  year = {${year || ''}},\n  volume = {${trueData.volume || ''}},\n  pages = {${trueData.pages || ''}}${trueData.doi ? `,\n  doi = {${trueData.doi}}` : ''}\n}`;
                                    }
                                }
                            } catch (e2) { console.warn('[CrossRef direct] failed:', e2.message); }
                        }
                    }
                }
            }
        }

        // B-check: title-search result has year diff > 2
        if (trueData && !foundViaId && item.extracted_year && trueData.year) {
            if (Math.abs(parseInt(item.extracted_year) - parseInt(trueData.year)) > 2) {
                const genFirstAuthor = (item.extracted_authors || [])[0];
                const refFirstAuthor = (trueData.authors || [])[0];
                const authorMatches = genFirstAuthor && refFirstAuthor && authorNamesMatch(genFirstAuthor, refFirstAuthor);

                if (!authorMatches) {
                    // Author mismatch → likely a different same-title paper → deep search with year filter
                    const deepResult = await deepSearchByTitle(item.title, item.extracted_year, item.extracted_authors);
                    if (deepResult) {
                        trueData = deepResult.trueData;
                        correctedBibtex = deepResult.correctedBibtex;
                        sources = [deepResult.source];
                        status = 'valid';
                    } else {
                        trueData = null;
                        correctedBibtex = null;
                        status = 'invalid';
                        sources = [];
                    }
                }
                // Author matches → same paper, year is hallucinated → fall through to Compare Phase
            }
        }

        // C. STRATEGY 3: Preprint ID Detection (arXiv, bioRxiv, medRxiv, SSRN)
        if (!trueData) {
            const orig = item.original || '';
            const arxivMatch = orig.match(/arXiv[:\s]+(\d{4}\.\d{4,5})/i);
            const biorxivMatch = orig.match(/(10\.1101\/[^\s,]+)/);
            const ssrnMatch = orig.match(/ssrn\.com\/abstract[=\s]+(\d+)/i);

            let preprintId = null;
            let preprintSource = null;

            if (arxivMatch) {
                preprintId = `10.48550/arXiv.${arxivMatch[1]}`;
                preprintSource = 'arXiv';
            } else if (biorxivMatch) {
                preprintId = biorxivMatch[1].replace(/[.,]+$/, '');
                preprintSource = 'bioRxiv/medRxiv';
            } else if (ssrnMatch) {
                preprintId = `https://papers.ssrn.com/abstract=${ssrnMatch[1]}`;
                preprintSource = 'SSRN';
            }

            if (preprintId) {
                try {
                    const cite = await Cite.async(preprintId);
                    const data = cite.data[0];
                    if (data) {
                        const authors = data.author
                            ? data.author.map(a => `${a.given || ''} ${a.family || ''}`.trim())
                            : [];
                        const year = data.issued?.['date-parts']?.[0]?.[0]?.toString();
                        trueData = {
                            title: data.title,
                            journal: data['container-title'] || preprintSource,
                            authors,
                            year,
                            volume: data.volume?.toString(),
                            issue: data.issue?.toString(),
                            pages: data.page?.toString(),
                            doi: data.DOI || null
                        };
                        status = 'valid';
                        sources.push(preprintSource);
                        correctedBibtex = cite.format('bibtex', { format: 'text' });
                    }
                } catch (e) {
                    console.warn(`[Preprint ${preprintSource}] failed for "${preprintId}":`, e.message);
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
            const normalizeJournal = s => normalize(toStr(s).replace(/&/g, 'and'));
            const genJournal = normalizeJournal(item.extracted_journal);
            const refJournal = normalizeJournal(trueData.journal);
            if (genJournal && refJournal && !stringsMatch(genJournal, refJournal)
                && titleSimilarity(toStr(item.extracted_journal), toStr(trueData.journal)) < 0.7) {
                isHallucinated = true;
                mismatchDetails.push(`Journal: "${item.extracted_journal}" vs "${trueData.journal}"`);
            }

            // 2. Authors
            const genAuthors = item.extracted_authors || [];
            const refAuthors = trueData.authors || [];
            if (genAuthors.length > 0 && refAuthors.length > 0) {
                // a. Check first 3 authors
                const checkCount = Math.min(3, genAuthors.length, refAuthors.length);
                for (let i = 0; i < checkCount; i++) {
                    if (!authorNamesMatch(genAuthors[i], refAuthors[i])) {
                        isHallucinated = true;
                        mismatchDetails.push(`Author ${i + 1} mismatch.`);
                    }
                }
                // b. Check last author (only meaningful when 4+ authors, otherwise already covered)
                const lastGenAuthor = genAuthors.at(-1) || '';
                if (genAuthors.length >= 4 && refAuthors.length >= 4 && !lastGenAuthor.toLowerCase().includes('et al')) {
                    if (!authorNamesMatch(lastGenAuthor, refAuthors.at(-1))) {
                        isHallucinated = true;
                        mismatchDetails.push(`Last author mismatch.`);
                    }
                }
                // c. Check count: flag if LLM listed MORE authors than actually exist
                if (genAuthors.length > refAuthors.length) {
                    isHallucinated = true;
                    mismatchDetails.push(`Author count: extracted ${genAuthors.length}, actual ${refAuthors.length}.`);
                }
            }

            // 3. Year (1-year difference tolerated: online-first vs print)
            if (item.extracted_year && trueData.year && Math.abs(parseInt(item.extracted_year) - parseInt(trueData.year)) > 1) {
                isHallucinated = true;
                mismatchDetails.push(`Year: "${item.extracted_year}" vs "${trueData.year}"`);
            }

            // 4. Volume
            checkMismatch(item.extracted_volume, trueData.volume, "Volume");

            // 5. Pages
            if (item.extracted_pages && trueData.pages) {
                const extractedHasRange = /[–—-]/.test(item.extracted_pages);
                if (extractedHasRange) {
                    // Full range: normalize abbreviated end (e.g. "577-80" → "577-580")
                    if (normalizePageRange(item.extracted_pages) !== normalizePageRange(trueData.pages)) {
                        isHallucinated = true;
                        mismatchDetails.push(`Pages: "${item.extracted_pages}" vs "${trueData.pages}"`);
                    }
                } else {
                    // Single start page: only compare start pages
                    const trueStart = trueData.pages.replace(/[–—-].*$/, '').trim();
                    if (normalize(item.extracted_pages) !== normalize(trueStart)) {
                        isHallucinated = true;
                        mismatchDetails.push(`Pages: "${item.extracted_pages}" vs "${trueData.pages}"`);
                    }
                }
            }

            if (isHallucinated) {
                status = 'corrected';
            }
        }

        validatedResults.push({
            ...item,
            status, // 'valid', 'corrected', 'invalid'
            sources,
            bibtex: correctedBibtex || item.bibtex,
            mismatchDetails,
            resolvedData: trueData
        });

        await delay(200);
    }

    return validatedResults;
}

function authorNamesMatch(a, b) {
    if (!a || !b) return false;
    // Split into tokens, exclude single-char initials (e.g. "L", "B")
    const tokens = str => str.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const ta = tokens(a), tb = tokens(b);
    if (ta.length === 0 || tb.length === 0) return false;
    // Match if any meaningful token (family name) appears in both
    return ta.some(t => tb.includes(t));
}

function titleSimilarity(a, b) {
    if (!a || !b) return 0;
    const tokens = s => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const ta = tokens(a), tb = tokens(b);
    let inter = 0;
    ta.forEach(t => { if (tb.has(t)) inter++; });
    return inter / (ta.size + tb.size - inter);
}

function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringsMatch(s1, s2) {
    if (!s1 || !s2) return false;
    return s1.includes(s2) || s2.includes(s1);
}

function normalizePageRange(p) {
    if (!p) return '';
    // Normalize dashes (en-dash, em-dash → hyphen)
    const s = p.replace(/[–—]/g, '-').trim();
    const m = s.match(/^(\d+)-(\d+)$/);
    if (m) {
        const start = m[1], end = m[2];
        // Expand abbreviated end: "577-80" → "577-580"
        const expanded = end.length < start.length
            ? start.slice(0, start.length - end.length) + end
            : end;
        return start + expanded;
    }
    return normalize(s);
}
