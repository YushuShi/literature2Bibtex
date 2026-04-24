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
        // Pre-1970 papers are not indexed in modern databases — skip validation
        const yearNum = parseInt(item.extracted_year);
        if (item.extracted_year && !isNaN(yearNum) && yearNum < 1970) {
            validatedResults.push({
                ...item,
                status: 'outdated',
                sources: [],
                bibtex: item.bibtex,
                mismatchDetails: [],
                resolvedData: null
            });
            continue;
        }

        let status = 'invalid'; // 'valid' | 'invalid' | 'corrected'
        let sources = []; // ['NCBI', 'Scopus']
        let trueData = null; // { title, authors: [], journal, year, volume, pages, doi, pmid }
        let correctedBibtex = null;
        let mismatchDetails = [];
        let lowConfidenceTitle = false; // true when CrossRef found via 0.70–0.85 title similarity
        let crossRefAuthors = null;    // CrossRef author list saved before NCBI A-parallel may replace

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
                        authors: data.author ? data.author.filter(a => a.given || a.family).map(a => `${a.given || ''} ${a.family || ''}`.trim()) : [],
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
                    crossRefAuthors = [...trueData.authors]; // save before A-parallel may replace with NCBI
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
                                let doi = (r.articleids || []).find(a => a.idtype === 'doi')?.value || null;
                                if (!doi) {
                                    try {
                                        const idcRes = await fetch(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmidFromUrl}&format=json`);
                                        if (idcRes.ok) doi = (await idcRes.json()).records?.[0]?.doi || null;
                                    } catch (e) { /* ignore */ }
                                }
                                trueData = {
                                    title: r.title,
                                    journal: r.fulljournalname || r.source,
                                    authors: (r.authors || []).filter(a => a.authtype === 'Author').map(a => a.name),
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

        // A-parallel: After CrossRef success, query NCBI + Scopus in parallel
        // NCBI author data preferred over CrossRef when available (more reliable ordering)
        if (foundViaId && trueData && sources.includes('CrossRef/Ref')) {
            const parDoi = trueData.doi;
            const parTitle = trueData.title;

            const [ncbiPar, scopusPar] = await Promise.allSettled([
                // NCBI: search by DOI (fallback: title), then fetch authors via esummary
                (async () => {
                    if (!parDoi && !parTitle) return null;
                    const term = parDoi ? `${parDoi}[doi]` : `${parTitle}[Title]`;
                    const p = new URLSearchParams({ db: 'pubmed', term, retmode: 'json' });
                    if (ncbiKey) p.append('api_key', ncbiKey);
                    const r = await fetch(`${NCBI_URL}?${p}`);
                    if (!r.ok) return null;
                    const d = await r.json();
                    const pmid = d.esearchresult?.idlist?.[0];
                    if (!pmid) return null;
                    const p2 = new URLSearchParams({ db: 'pubmed', id: pmid, retmode: 'json' });
                    if (ncbiKey) p2.append('api_key', ncbiKey);
                    const r2 = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${p2}`);
                    if (!r2.ok) return null;
                    const d2 = await r2.json();
                    const rec = d2.result?.[pmid];
                    if (!rec || rec.error || !rec.title) return null;
                    return { authors: (rec.authors || []).filter(a => a.authtype === 'Author').map(a => a.name) };
                })(),
                // Scopus: confirm by DOI (badge only, no author data used)
                (async () => {
                    if (!elsevierKey || !parDoi) return null;
                    const r = await fetch(`${SCOPUS_URL}?query=DOI(${encodeURIComponent(parDoi)})&count=1`, {
                        headers: { 'X-ELS-APIKey': elsevierKey, 'Accept': 'application/json' }
                    });
                    if (!r.ok) return null;
                    const d = await r.json();
                    const entry = d['search-results']?.entry?.[0];
                    return (entry && !entry.error) ? true : null;
                })()
            ]);

            if (ncbiPar.status === 'fulfilled' && ncbiPar.value?.authors?.length > 0) {
                sources.push('NCBI');
                trueData = { ...trueData, authors: ncbiPar.value.authors };
            }
            if (scopusPar.status === 'fulfilled' && scopusPar.value) {
                sources.push('Scopus');
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
                            } else if (bestCRSim >= 0.70 && bestCR?.DOI) {
                                foundId = bestCR.DOI;
                                foundSource = 'CrossRef';
                                lowConfidenceTitle = true;
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
                                authors: data.author ? data.author.filter(a => a.given || a.family).map(a => `${a.given || ''} ${a.family || ''}`.trim()) : [],
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
                                        let doiFromArticleids = (r.articleids || []).find(a => a.idtype === 'doi')?.value || null;
                                        let doiFromIdConv = null;
                                        if (!doiFromArticleids) {
                                            try {
                                                const idcRes = await fetch(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${foundId}&format=json`);
                                                if (idcRes.ok) doiFromIdConv = (await idcRes.json()).records?.[0]?.doi || null;
                                            } catch (e) { /* ignore */ }
                                        }
                                        const doi = doiFromArticleids || doiFromIdConv;
                                        const authors = (r.authors || []).filter(a => a.authtype === 'Author').map(a => a.name);
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
                                        const authors = (w.author || []).filter(a => a.given || a.family).map(a => `${a.given || ''} ${a.family || ''}`.trim());
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

        // B-check: verify title-search result is the right paper
        if (trueData && !foundViaId) {
            const genFirstAuthor = (item.extracted_authors || [])[0];
            const refFirstAuthor = (trueData.authors || [])[0];
            const authorMismatch = genFirstAuthor && refFirstAuthor &&
                !authorNamesMatch(genFirstAuthor, refFirstAuthor);

            const extractedJournal = toStr(item.extracted_journal);
            const foundJournal = toStr(trueData.journal);
            const journalMismatch = extractedJournal && foundJournal &&
                titleSimilarity(extractedJournal, foundJournal) < 0.3 &&
                !journalAbbrevMatch(extractedJournal, foundJournal);

            const yearMismatch = item.extracted_year && trueData.year &&
                Math.abs(parseInt(item.extracted_year) - parseInt(trueData.year)) > 1;

            if (authorMismatch && journalMismatch) {
                // Author + journal both disagree → likely found a different same-title paper → deep search
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
            } else if (authorMismatch && yearMismatch) {
                // Author + year both disagree → likely wrong paper → deep search
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
            } else if (yearMismatch) {
                // Year diff only (author + journal match) → could be online-first → deep search for better match
                const deepResult = await deepSearchByTitle(item.title, item.extracted_year, item.extracted_authors);
                if (deepResult) {
                    trueData = deepResult.trueData;
                    correctedBibtex = deepResult.correctedBibtex;
                    sources = [deepResult.source];
                    status = 'valid';
                }
                // If not found: keep trueData → Compare Phase will flag year diff
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
            // pendingMismatches: journal / year / volume / pages — sent to CrossRef arbitration if mismatch
            // Authors are committed directly (NCBI author data is generally more reliable than CrossRef)
            const pendingMismatches = []; // { field, label, extracted }

            // 1. Journal
            const normalizeJournal = s => normalize(toStr(s).replace(/&/g, 'and'));
            const genJournal = normalizeJournal(item.extracted_journal);
            const refJournal = normalizeJournal(trueData.journal);
            if (genJournal && refJournal && !stringsMatch(genJournal, refJournal)
                && titleSimilarity(toStr(item.extracted_journal), toStr(trueData.journal)) < 0.7
                && !journalAbbrevMatch(toStr(item.extracted_journal), toStr(trueData.journal))) {
                pendingMismatches.push({ field: 'journal', label: `Journal: "${item.extracted_journal}" vs "${trueData.journal}"`, extracted: toStr(item.extracted_journal) });
            }

            // 2. Authors (committed directly, not arbitrated via CrossRef)
            const genAuthors = item.extracted_authors || [];
            const refAuthors = trueData.authors || [];
            const isCollective = name =>
                /\b(group|committee|members|task\s+force|collaboration|consortium|developed|network|initiative|investigators|association|society|foundation|rehabilitation|prevention|federation)\b/i.test(name);
            const allRefCollective = refAuthors.length > 0 && refAuthors.every(a => isCollective(a));
            if (genAuthors.length > 0 && refAuthors.length > 0 && !allRefCollective) {
                const genOffset = (genAuthors.length > 1 && isCollective(genAuthors[0]) && !isCollective(refAuthors[0])) ? 1 : 0;
                // Strip "et al." placeholders before comparison (LLM extracts them literally from abbreviated citations)
                const effectiveGenAuthors = genAuthors.filter(a => !a.toLowerCase().includes('et al'));
                // a. Check first 3 authors
                const checkCount = Math.min(3, effectiveGenAuthors.length - genOffset, refAuthors.length);
                console.log(`[DBG-Auth] "${item.title?.substring(0,45)}" | src:${sources} | genOff:${genOffset} | chk:${checkCount} | gen:`, genAuthors, '| ref:', refAuthors);
                const allKnownAuthors = [
                    ...refAuthors,
                    ...(crossRefAuthors || [])
                ];
                for (let i = 0; i < checkCount; i++) {
                    const matched = authorNamesMatch(effectiveGenAuthors[i + genOffset], refAuthors[i]);
                    if (!matched) {
                        console.log(`[DBG-Auth]   Author ${i+1} MISMATCH: gen="${effectiveGenAuthors[i+genOffset]}" ref="${refAuthors[i]}"`);
                        // Check if gen author appears anywhere in either known list (ordering vs fabrication)
                        const foundElsewhere = allKnownAuthors.some(r => authorNamesMatch(effectiveGenAuthors[i + genOffset], r));
                        if (foundElsewhere) {
                            mismatchDetails.push(`Author ${i + 1} mismatch (found in different position).`);
                        } else {
                            mismatchDetails.push(`Author ${i + 1} mismatch (possibly fabricated).`);
                        }
                    }
                }
                // b. Check last author (only when 4+ authors, same count, and last gen is not "et al.")
                const lastGenAuthor = genAuthors.at(-1) || '';
                if (genAuthors.length >= 4 && genAuthors.length === refAuthors.length
                    && !lastGenAuthor.toLowerCase().includes('et al')) {
                    if (!authorNamesMatch(lastGenAuthor, refAuthors.at(-1))) {
                        mismatchDetails.push(`Last author mismatch.`);
                    }
                }
                // c. Check count: flag if LLM listed MORE authors than actually exist
                // diff >= 2 required: allow 1 author missing from DB (common data quality gap)
                // (skip when refAuthors has only 1 entry — Scopus dc:creator is inherently incomplete)
                if (refAuthors.length > 1 && effectiveGenAuthors.length > refAuthors.length + 1) {
                    mismatchDetails.push(`Author count: extracted ${effectiveGenAuthors.length}, actual ${refAuthors.length}.`);
                }
            }

            // 3. Year (1-year difference tolerated: online-first vs print)
            if (item.extracted_year && trueData.year && Math.abs(parseInt(item.extracted_year) - parseInt(trueData.year)) > 1) {
                pendingMismatches.push({ field: 'year', label: `Year: "${item.extracted_year}" vs "${trueData.year}"`, extracted: item.extracted_year });
            }

            // 4. Volume
            const ev = toStr(item.extracted_volume), tv = toStr(trueData.volume);
            if (ev && tv && normalize(ev) !== normalize(tv) && !tv.includes(ev) && !ev.includes(tv)) {
                pendingMismatches.push({ field: 'volume', label: `Volume: "${ev}" vs "${tv}"`, extracted: ev });
            }

            // 5. Pages
            const hasRangeSep = s => /[–—~-]/.test(s);
            if (item.extracted_pages && trueData.pages) {
                const ep = stripEloc(item.extracted_pages.trim());
                const tp = stripEloc(trueData.pages.trim());
                if (!isArticleId(ep) && !isArticleId(tp)) {
                    let pagesMismatch = false;
                    if (hasRangeSep(ep)) {
                        if (hasRangeSep(tp)) {
                            if (normalizePageRange(ep) !== normalizePageRange(tp)) pagesMismatch = true;
                        } else {
                            // DB only has start page: compare start pages
                            const epStart = ep.replace(/[–—~-].*$/, '').trim();
                            if (normalize(epStart) !== normalize(tp)) pagesMismatch = true;
                        }
                    } else {
                        // ep is a bare number: compare against start of tp range
                        const trueStart = tp.replace(/[–—~-].*$/, '').trim();
                        if (normalize(ep) !== normalize(trueStart) && !/^\d{5,}$/.test(ep)) pagesMismatch = true;
                    }
                    if (pagesMismatch) {
                        pendingMismatches.push({ field: 'pages', label: `Pages: "${ep}" vs "${tp}"`, extracted: ep });
                    }
                }
            }

            // CrossRef Arbitration: when NCBI data causes a mismatch, consult CrossRef as secondary source
            // Skip if CrossRef was already the primary source (would yield the same result)
            let isHallucinated = mismatchDetails.length > 0; // author mismatches already committed above
            if (pendingMismatches.length > 0) {
                const canArbitrate = trueData.doi && !sources.some(s => s.includes('CrossRef'));
                if (canArbitrate) {
                    let w = null;
                    try {
                        const crRes = await fetch(`https://api.crossref.org/works/${trueData.doi}`);
                        if (crRes.ok) w = (await crRes.json()).message || null;
                    } catch (e) {
                        console.warn('[CrossRef arbitration] fetch failed:', e.message);
                    }

                    if (w) {
                        // Collect CrossRef authors for fabrication detection (zero extra API cost)
                        if (!crossRefAuthors && w.author) {
                            crossRefAuthors = (w.author || [])
                                .filter(a => a.given || a.family)
                                .map(a => `${a.given || ''} ${a.family || ''}`.trim());
                        }
                        const crJournal = w['container-title']?.[0] || w['short-container-title']?.[0] || '';
                        const crYear = w.issued?.['date-parts']?.[0]?.[0]?.toString()
                            || w['published-online']?.['date-parts']?.[0]?.[0]?.toString() || '';
                        const crVolume = w.volume?.toString() || '';
                        const crPages = w.page?.toString() || '';

                        let xrefHelped = false;
                        for (const pm of pendingMismatches) {
                            let resolved = false;
                            if (pm.field === 'pages' && crPages) {
                                const crPg = stripEloc(crPages.trim());
                                const exPg = pm.extracted;
                                if (isArticleId(crPg)) {
                                    // CrossRef confirms article number (e.g. "1099-1099") — cannot compare
                                    // with print page range; treat as valid (DB lacks print pagination)
                                    resolved = true;
                                } else if (!isArticleId(exPg)) {
                                    if (hasRangeSep(exPg)) {
                                        resolved = hasRangeSep(crPg)
                                            ? normalizePageRange(exPg) === normalizePageRange(crPg)
                                            : normalize(exPg.replace(/[–—~-].*$/, '').trim()) === normalize(crPg);
                                    } else {
                                        resolved = normalize(exPg) === normalize(crPg.replace(/[–—~-].*$/, '').trim());
                                    }
                                }
                            } else if (pm.field === 'journal' && crJournal) {
                                resolved = journalAbbrevMatch(pm.extracted, crJournal)
                                    || titleSimilarity(pm.extracted, crJournal) >= 0.7;
                            } else if (pm.field === 'year' && crYear) {
                                resolved = Math.abs(parseInt(pm.extracted) - parseInt(crYear)) <= 1;
                            } else if (pm.field === 'volume' && crVolume) {
                                resolved = normalize(pm.extracted) === normalize(crVolume)
                                    || crVolume.includes(pm.extracted) || pm.extracted.includes(crVolume);
                            }

                            if (resolved) {
                                xrefHelped = true;
                            } else {
                                isHallucinated = true;
                                mismatchDetails.push(pm.label);
                            }
                        }
                        if (xrefHelped && !sources.includes('CrossRef')) sources.push('CrossRef');
                    } else {
                        // CrossRef returned no match — commit pending mismatches directly
                        isHallucinated = true;
                        mismatchDetails.push(...pendingMismatches.map(m => m.label));
                    }
                } else {
                    // No DOI available, or CrossRef already primary — commit pending mismatches directly
                    isHallucinated = true;
                    mismatchDetails.push(...pendingMismatches.map(m => m.label));
                }
            }

            if (isHallucinated) status = 'corrected';

            // Low-confidence title match (0.70–0.85): require at most 1 mismatch category
            // If 2+ field categories mismatch, this is likely a different paper → reject
            if (lowConfidenceTitle && status !== 'invalid') {
                const mismatchCats = new Set(mismatchDetails.map(m =>
                    (m.startsWith('Author') || m.startsWith('Last')) ? 'author'
                    : m.startsWith('Journal') ? 'journal'
                    : m.startsWith('Year') ? 'year'
                    : m.startsWith('Volume') ? 'volume'
                    : m.startsWith('Pages') ? 'pages' : 'other'
                ));
                if (mismatchCats.size >= 2) {
                    status = 'invalid';
                    trueData = null;
                    correctedBibtex = null;
                    sources = [];
                    mismatchDetails = [];
                }
            }
        }

        // Non-journal / unverifiable: book, web resource, grey literature
        if (status === 'invalid') {
            const bibtexType = (item.bibtex || '').trim().toLowerCase();
            const isNonJournal = /^@(book|misc|techreport|manual|inbook|incollection)\b/.test(bibtexType)
                || (!item.extracted_journal && !item.doi && !item.pmid);
            if (isNonJournal) status = 'unverifiable';
        }

        validatedResults.push({
            ...item,
            status, // 'valid', 'corrected', 'invalid', 'unverifiable', 'outdated'
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
    // NFD normalization: decompose precomposed chars (á→a+combining) then strip combining marks
    // This unifies PDF-extracted decomposed accents with database precomposed Unicode
    const tokens = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const ta = tokens(a), tb = tokens(b);
    // If extracted name has no valid tokens (garbled PDF chars), skip comparison
    if (ta.length === 0) return true;
    if (tb.length === 0) return false;
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

function journalAbbrevMatch(a, b) {
    // Check if one is an ISO 4 abbreviation of the other
    // e.g. "J. Psychiatr. Res." ↔ "Journal of Psychiatric Research"
    // Both-direction prefix match: every token in each side must prefix-match some token on the other side
    const stopWords = new Set(['the', 'and', 'of', 'in', 'for', 'on', 'a', 'an', 'amp']);
    // Strip NCBI-style subtitle: "Journal of Foo : official journal of the Bar Society" → "Journal of Foo"
    // Requires space before ":" to avoid splitting "CA: A Cancer Journal for Clinicians" at the colon
    const stripSubtitle = s => s.split(/\s+:\s+/)[0];
    const tokens = s => stripSubtitle(s).toLowerCase()
        .replace(/&amp;|&/g, ' ')
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0 && !stopWords.has(t));
    const ta = tokens(a), tb = tokens(b);
    if (ta.length === 0 || tb.length === 0) return false;
    // check(abbrev, full): every abbrev token prefixes some full token, AND every full token is prefixed by some abbrev token
    const check = (abbrev, full) =>
        abbrev.every(x => full.some(y => y.startsWith(x))) &&
        full.every(y => abbrev.some(x => y.startsWith(x)));
    return check(ta, tb) || check(tb, ta);
}

function isArticleId(p) {
    const s = p.trim();
    if (/^\d{6,}$/.test(s)) return true;
    // CrossRef represents article numbers as "N-N" (start == end, N ≥ 3 digits)
    // e.g. "1099-1099" — Springer Nature submits article numbers this way
    if (/^(\d{3,})-\1$/.test(s)) return true;
    return false;
}

function stripEloc(s) {
    // Strip electronic location suffix (.eN or space+eN) after a numeric page range
    // e.g. "949-963.e18" → "949-963", "1653–1666 e7" → "1653–1666"
    // Requires numeric main body to avoid stripping standalone "e15" article IDs
    const m = s.match(/^(\d[\d\u2013\u2014~-]*\d)\s*\.?\s*e\d+$/i);
    return m ? m[1] : s;
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
