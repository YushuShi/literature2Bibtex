// Detects and parses author name into { family, given }
// Handles "Given Family" (CrossRef) and "Family Initials" (NCBI) formats
function parseAuthorName(name) {
    if (!name?.trim()) return { family: '', given: '' };
    const parts = name.replace(/\.$/, '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { family: '', given: '' };
    if (parts.length === 1) return { family: parts[0], given: '' };
    const last = parts[parts.length - 1];
    // "Family Initials" format: last token is 1-3 uppercase letters
    if (/^[A-Z]{1,3}$/.test(last)) {
        return { family: parts.slice(0, -1).join(' '), given: last };
    }
    // "Given Family" format
    return { family: last, given: parts.slice(0, -1).join(' ') };
}

function toInitials(given) {
    if (!given) return '';
    return given.split(/\s+/).filter(Boolean).map(g => g[0].toUpperCase() + '.').join(' ');
}

function getItemData(item) {
    const r = item.resolvedData;
    return {
        authors: r?.authors || item.extracted_authors || [],
        year:    r?.year    || item.extracted_year    || '',
        title:   r?.title   || item.title             || '',
        journal: r?.journal || item.extracted_journal || '',
        volume:  r?.volume  || item.extracted_volume  || '',
        issue:   r?.issue   || '',
        pages:   r?.pages   || item.extracted_pages   || '',
        doi:     r?.doi     || item.doi               || '',
    };
}

// ─── APA 7th Edition ──────────────────────────────────────────────────────────
function apaAuthors(parsed) {
    const fmt = a => a.family + (a.given ? ', ' + toInitials(a.given) : '');
    if (parsed.length === 0) return '';
    if (parsed.length === 1) return fmt(parsed[0]);
    if (parsed.length <= 20)
        return parsed.slice(0, -1).map(fmt).join(', ') + ', & ' + fmt(parsed[parsed.length - 1]);
    return parsed.slice(0, 19).map(fmt).join(', ') + ', ... ' + fmt(parsed[parsed.length - 1]);
}

function formatAPA(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += apaAuthors(parsed) + ' ';
    s += `(${d.year || 'n.d.'}). `;
    if (d.title) s += d.title + '. ';
    if (d.journal) {
        s += d.journal;
        if (d.volume) { s += ', ' + d.volume; if (d.issue) s += '(' + d.issue + ')'; }
        if (d.pages) s += ', ' + d.pages;
        s += '.';
    }
    if (d.doi) s += ' https://doi.org/' + d.doi;
    return s.trim();
}

// ─── MLA 9th Edition ──────────────────────────────────────────────────────────
function mlaAuthors(parsed) {
    const full = a => (a.given ? a.given + ' ' : '') + a.family;
    const rev  = a => a.family + (a.given ? ', ' + a.given : '');
    if (parsed.length === 0) return '';
    if (parsed.length === 1) return rev(parsed[0]);
    if (parsed.length === 2) return rev(parsed[0]) + ', and ' + full(parsed[1]);
    return rev(parsed[0]) + ', et al.';
}

function formatMLA(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += mlaAuthors(parsed) + '. ';
    if (d.title) s += `"${d.title}." `;
    if (d.journal) s += d.journal + ', ';
    if (d.volume) s += 'vol. ' + d.volume + ', ';
    if (d.issue)  s += 'no. '  + d.issue  + ', ';
    if (d.year)   s += d.year  + ', ';
    if (d.pages)  s += 'pp. '  + d.pages  + '.';
    if (d.doi)    s += ' doi:' + d.doi    + '.';
    return s.trim().replace(/,\s*$/, '.');
}

// ─── Chicago Notes-Bibliography 17th ──────────────────────────────────────────
function chicagoAuthors(parsed) {
    const full = a => (a.given ? a.given + ' ' : '') + a.family;
    const rev  = a => a.family + (a.given ? ', ' + a.given : '');
    if (parsed.length === 0) return '';
    if (parsed.length === 1) return rev(parsed[0]);
    if (parsed.length <= 3)
        return rev(parsed[0]) + ', and ' + parsed.slice(1).map(full).join(', and ');
    return rev(parsed[0]) + ', et al.';
}

function formatChicago(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += chicagoAuthors(parsed) + '. ';
    if (d.title) s += `"${d.title}." `;
    if (d.journal) {
        s += d.journal;
        if (d.volume) s += ' ' + d.volume;
        if (d.issue)  s += ', no. ' + d.issue;
        if (d.year)   s += ' (' + d.year + ')';
        if (d.pages)  s += ': ' + d.pages;
        s += '.';
    }
    if (d.doi) s += ' https://doi.org/' + d.doi + '.';
    return s.trim();
}

// ─── Vancouver ────────────────────────────────────────────────────────────────
function vancouverAuthors(parsed) {
    const fmt = a => a.family + (a.given ? ' ' + toInitials(a.given).replace(/\.\s*/g, '') : '');
    if (parsed.length === 0) return '';
    if (parsed.length <= 6) return parsed.map(fmt).join(', ');
    return parsed.slice(0, 6).map(fmt).join(', ') + ', et al.';
}

function formatVancouver(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += vancouverAuthors(parsed) + '. ';
    if (d.title)   s += d.title   + '. ';
    if (d.journal) s += d.journal + '. ';
    if (d.year)    s += d.year;
    if (d.volume)  s += ';' + d.volume;
    if (d.issue)   s += '(' + d.issue + ')';
    if (d.pages)   s += ':' + d.pages;
    if (d.year || d.volume || d.pages) s += '.';
    if (d.doi) s += ' doi:' + d.doi + '.';
    return s.trim();
}

// ─── IEEE ─────────────────────────────────────────────────────────────────────
function ieeeAuthors(parsed) {
    const fmt = a => (a.given ? toInitials(a.given) + ' ' : '') + a.family;
    if (parsed.length === 0) return '';
    if (parsed.length === 1) return fmt(parsed[0]);
    if (parsed.length <= 6)
        return parsed.slice(0, -1).map(fmt).join(', ') + ', and ' + fmt(parsed[parsed.length - 1]);
    return parsed.slice(0, 6).map(fmt).join(', ') + ' et al.';
}

function formatIEEE(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += ieeeAuthors(parsed) + ', ';
    if (d.title)   s += `"${d.title}," `;
    if (d.journal) s += d.journal + ', ';
    if (d.volume)  s += 'vol. ' + d.volume + ', ';
    if (d.issue)   s += 'no. '  + d.issue  + ', ';
    if (d.pages)   s += 'pp. '  + d.pages  + ', ';
    if (d.year)    s += d.year  + '.';
    if (d.doi)     s += ' doi: ' + d.doi   + '.';
    return s.trim().replace(/,\s*$/, '.');
}

// ─── AMA 11th Edition ─────────────────────────────────────────────────────────
function amaAuthors(parsed) {
    // "Last FI" — no periods, no spaces between initials
    const fmt = a => {
        const inits = a.given ? a.given.split(/\s+/).filter(Boolean).map(g => g[0].toUpperCase()).join('') : '';
        return a.family + (inits ? ' ' + inits : '');
    };
    if (parsed.length === 0) return '';
    if (parsed.length <= 6) return parsed.map(fmt).join(', ');
    return parsed.slice(0, 6).map(fmt).join(', ') + ', et al.';
}

function formatAMA(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += amaAuthors(parsed) + '. ';
    if (d.title)   s += d.title   + '. ';
    if (d.journal) s += d.journal + '. ';
    if (d.year)    s += d.year;
    if (d.volume)  s += ';' + d.volume;
    if (d.issue)   s += '(' + d.issue + ')';
    if (d.pages)   s += ':' + d.pages;
    if (d.year || d.volume || d.pages) s += '.';
    if (d.doi) s += ' doi:' + d.doi;
    return s.trim();
}

// ─── AMJ (Academy of Management Journal) ─────────────────────────────────────
function formatAMJ(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    const fmt = a => a.family + (a.given ? ', ' + toInitials(a.given) : '');
    let authorStr = '';
    if (parsed.length === 1) authorStr = fmt(parsed[0]);
    else if (parsed.length > 1)
        authorStr = parsed.slice(0, -1).map(fmt).join(', ') + ', & ' + fmt(parsed[parsed.length - 1]);
    let s = '';
    if (authorStr) s += authorStr + ' ';
    if (d.year)    s += d.year + '. ';
    if (d.title)   s += d.title + '. ';
    if (d.journal) {
        s += d.journal;
        if (d.volume) { s += ', ' + d.volume; if (d.issue) s += '(' + d.issue + ')'; }
        if (d.pages) s += ': ' + d.pages;
        s += '.';
    }
    if (d.doi) s += ' https://doi.org/' + d.doi;
    return s.trim();
}

// ─── ACS ─────────────────────────────────────────────────────────────────────
function acsAuthors(parsed) {
    const fmt = a => a.family + (a.given ? ', ' + toInitials(a.given) : '');
    return parsed.map(fmt).join('; ');
}

function formatACS(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += acsAuthors(parsed) + '. ';
    if (d.journal) s += d.journal + ' ';
    if (d.year)    s += d.year + ', ';
    if (d.volume)  s += d.volume;
    if (d.issue)   s += ' (' + d.issue + ')';
    if (d.pages)   s += ', ' + d.pages;
    s += '.';
    if (d.doi) s += ' https://doi.org/' + d.doi;
    return s.trim();
}

// ─── Harvard Gatton ───────────────────────────────────────────────────────────
function harvardGattonAuthors(parsed) {
    const fmt = a => {
        const inits = a.given ? a.given.split(/\s+/).filter(Boolean).map(g => g[0].toUpperCase()).join('') : '';
        return a.family + (inits ? ' ' + inits : '');
    };
    if (parsed.length === 0) return '';
    if (parsed.length === 1) return fmt(parsed[0]);
    if (parsed.length <= 3)
        return parsed.slice(0, -1).map(fmt).join(', ') + ' & ' + fmt(parsed[parsed.length - 1]);
    return fmt(parsed[0]) + ' et al.';
}

function formatHarvardGatton(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    let s = '';
    if (parsed.length) s += harvardGattonAuthors(parsed) + ' ';
    if (d.year)    s += d.year    + ', ';
    if (d.title)   s += `'${d.title}', `;
    if (d.journal) s += d.journal + ', ';
    if (d.volume)  s += 'vol. '   + d.volume + ', ';
    if (d.issue)   s += 'no. '    + d.issue  + ', ';
    if (d.pages)   s += 'pp. '    + d.pages  + '.';
    if (d.doi)     s += ' doi:'   + d.doi    + '.';
    return s.trim().replace(/,\s*$/, '.');
}

// ─── RIS Export ───────────────────────────────────────────────────────────────
function buildRISEntry(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    const lines = ['TY  - JOUR'];
    parsed.forEach(a => {
        lines.push('AU  - ' + a.family + (a.given ? ', ' + a.given : ''));
    });
    if (d.title)   lines.push('TI  - ' + d.title);
    if (d.journal) lines.push('JO  - ' + d.journal);
    if (d.year)    lines.push('PY  - ' + d.year);
    if (d.volume)  lines.push('VL  - ' + d.volume);
    if (d.issue)   lines.push('IS  - ' + d.issue);
    if (d.pages) {
        const parts = d.pages.split(/[-–]/);
        lines.push('SP  - ' + parts[0].trim());
        if (parts[1]) lines.push('EP  - ' + parts[1].trim());
    }
    if (d.doi)     lines.push('DO  - ' + d.doi);
    lines.push('ER  - ');
    return lines.join('\n');
}

export function buildRIS(results) {
    return results.map(buildRISEntry).join('\n\n');
}

// ─── NBIB Export ──────────────────────────────────────────────────────────────
function buildNBIBEntry(item) {
    const d = getItemData(item);
    const parsed = d.authors.map(parseAuthorName);
    const lines = [];
    if (item.pmid)  lines.push('PMID- ' + item.pmid);
    if (d.title)    lines.push('TI  - ' + d.title);
    parsed.forEach(a => {
        const inits = a.given ? a.given.split(/\s+/).filter(Boolean).map(g => g[0].toUpperCase()).join('') : '';
        lines.push('AU  - ' + a.family + (inits ? ' ' + inits : ''));
    });
    if (d.journal)  lines.push('TA  - ' + d.journal);
    if (d.year)     lines.push('DP  - ' + d.year);
    if (d.volume)   lines.push('VI  - ' + d.volume);
    if (d.issue)    lines.push('IP  - ' + d.issue);
    if (d.pages)    lines.push('PG  - ' + d.pages);
    if (d.doi)      lines.push('LID - ' + d.doi + ' [doi]');
    lines.push('');
    return lines.join('\n');
}

export function buildNBIB(results) {
    return results.map(buildNBIBEntry).join('\n');
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function formatCitation(item, format) {
    switch (format) {
        case 'apa':            return formatAPA(item);
        case 'mla':            return formatMLA(item);
        case 'chicago':        return formatChicago(item);
        case 'vancouver':      return formatVancouver(item);
        case 'ieee':           return formatIEEE(item);
        case 'ama':            return formatAMA(item);
        case 'amj':            return formatAMJ(item);
        case 'acs':            return formatACS(item);
        case 'harvard-gatton': return formatHarvardGatton(item);
        default:               return item.bibtex || '';
    }
}

export const FORMAT_LABELS = {
    bibtex:          'BibTeX',
    apa:             'APA',
    mla:             'MLA',
    ieee:            'IEEE',
    chicago:         'Chicago',
    vancouver:       'Vancouver',
    ama:             'AMA',
    amj:             'AMJ',
    acs:             'ACS',
    'harvard-gatton':'Harvard Gatton',
};

export const PRIMARY_FORMATS = ['bibtex', 'apa', 'mla', 'ieee'];
export const OTHER_FORMATS   = ['chicago', 'vancouver', 'ama', 'amj', 'acs', 'harvard-gatton'];
