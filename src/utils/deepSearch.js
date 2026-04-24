import Cite from 'citation-js';

const TITLE_SIM_THRESHOLD = 0.85;

function titleSimilarity(a, b) {
    if (!a || !b) return 0;
    const tokens = s => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const ta = tokens(a), tb = tokens(b);
    let inter = 0;
    ta.forEach(t => { if (tb.has(t)) inter++; });
    return inter / (ta.size + tb.size - inter);
}

function authorNamesMatch(a, b) {
    if (!a || !b) return false;
    const tokens = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const ta = tokens(a), tb = tokens(b);
    if (ta.length === 0) return true;
    if (tb.length === 0) return false;
    return ta.some(t => tb.includes(t));
}

function scoreCandidate(candidate, targetYear, targetAuthors) {
    let score = 0;
    if (candidate.year && targetYear) {
        const diff = Math.abs(parseInt(candidate.year) - parseInt(targetYear));
        if (diff === 0) score += 3;
        else if (diff === 1) score += 1;
    }
    if (targetAuthors?.length > 0 && candidate.authors?.length > 0) {
        if (authorNamesMatch(targetAuthors[0], candidate.authors[0])) score += 2;
    }
    return score;
}

// Deep search with year filter when B-check detects a possible same-title different paper.
// Returns { trueData, correctedBibtex, source } or null.
export async function deepSearchByTitle(title, year, authors) {
    if (!title) return null;

    const cleanedTitle = String(title).replace(/[{}]/g, '').replace(/['"]/g, '').trim();
    let bestResult = null;
    let bestScore = -1;
    let bestSource = null;

    // 1. CrossRef with year filter
    try {
        let url = `https://api.crossref.org/works?query.title=${encodeURIComponent(cleanedTitle)}&rows=10&select=DOI,title,author,issued,container-title,volume,page,issue`;
        if (year) url += `&filter=from-pub-date:${year}-01-01,until-pub-date:${year}-12-31`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            for (const it of (data.message?.items || [])) {
                const sim = titleSimilarity(it.title?.[0], cleanedTitle);
                if (sim < TITLE_SIM_THRESHOLD) continue;
                const candidateYear = it.issued?.['date-parts']?.[0]?.[0]?.toString();
                const candidateAuthors = (it.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim());
                const score = scoreCandidate({ year: candidateYear, authors: candidateAuthors }, year, authors);
                if (score > bestScore) {
                    bestScore = score;
                    bestResult = { doi: it.DOI, year: candidateYear, authors: candidateAuthors, journal: it['container-title']?.[0], volume: it.volume?.toString(), pages: it.page?.toString(), title: it.title?.[0] };
                    bestSource = 'CrossRef';
                }
            }
        }
    } catch (e) {
        console.warn('[deepSearch CrossRef] failed:', e.message);
    }

    // 2. Semantic Scholar with year filter
    try {
        let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(cleanedTitle)}&fields=title,authors,year,externalIds,venue&limit=10`;
        if (year) url += `&year=${year}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            for (const p of (data.data || [])) {
                const sim = titleSimilarity(p.title, cleanedTitle);
                if (sim < TITLE_SIM_THRESHOLD) continue;
                const candidateYear = p.year?.toString();
                const candidateAuthors = (p.authors || []).map(a => a.name);
                const score = scoreCandidate({ year: candidateYear, authors: candidateAuthors }, year, authors);
                if (score > bestScore) {
                    const arxivId = p.externalIds?.ArXiv || null;
                    const doi = p.externalIds?.DOI || (arxivId ? `10.48550/arXiv.${arxivId}` : null);
                    bestScore = score;
                    bestResult = { doi, year: candidateYear, authors: candidateAuthors, journal: p.venue || (arxivId ? 'arXiv' : null), volume: null, pages: null, title: p.title };
                    bestSource = arxivId ? 'arXiv' : 'Semantic Scholar';
                }
            }
        }
    } catch (e) {
        console.warn('[deepSearch Semantic Scholar] failed:', e.message);
    }

    // Require at least year match OR author match (score >= 2)
    if (!bestResult || bestScore < 2) return null;

    // Resolve full BibTeX via Cite.async if DOI available
    if (bestResult.doi) {
        try {
            const cite = await Cite.async(bestResult.doi);
            const data = cite.data[0];
            if (data) {
                const trueData = {
                    title: data.title || bestResult.title,
                    journal: data['container-title'] || bestResult.journal,
                    authors: data.author ? data.author.filter(a => a.given || a.family).map(a => `${a.given || ''} ${a.family || ''}`.trim()) : bestResult.authors,
                    year: data.issued?.['date-parts']?.[0]?.[0]?.toString() || bestResult.year,
                    volume: data.volume?.toString() || bestResult.volume,
                    issue: data.issue?.toString(),
                    pages: data.page?.toString() || bestResult.pages,
                    doi: data.DOI || bestResult.doi
                };
                return { trueData, correctedBibtex: cite.format('bibtex', { format: 'text' }), source: bestSource };
            }
        } catch (e) {
            console.warn('[deepSearch Cite.async] failed:', e.message);
        }
    }

    // Fallback: construct BibTeX manually
    const authorKey = bestResult.authors[0]?.split(/[,\s]+/)?.pop() || 'unknown';
    const correctedBibtex = `@article{${authorKey}${bestResult.year || ''},\n  author = {${bestResult.authors.join(' and ')}},\n  title = {${bestResult.title || ''}},\n  journal = {${bestResult.journal || ''}},\n  year = {${bestResult.year || ''}},\n  volume = {${bestResult.volume || ''}},\n  pages = {${bestResult.pages || ''}}${bestResult.doi ? `,\n  doi = {${bestResult.doi}}` : ''}\n}`;

    return { trueData: bestResult, correctedBibtex, source: bestSource };
}
