import React, { useState } from 'react';
import { BookOpen, Copy, Download, RefreshCw, FileText, Check, AlertCircle, AlertTriangle, Settings } from 'lucide-react';
import { convertToBibtex } from './utils/bibtexConverter';
import { validateCitations } from './utils/citationValidator';
import { formatCitation, FORMAT_LABELS, PRIMARY_FORMATS, OTHER_FORMATS, buildRIS, buildNBIB } from './utils/formatCitation';
import { PROVIDERS } from './utils/llmProviders';

function App() {
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('gemini');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [outputFormat, setOutputFormat] = useState('bibtex');
  const [showOtherFormats, setShowOtherFormats] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState(() => ({
    gemini: localStorage.getItem('apiKey_gemini') || '',
    openai: localStorage.getItem('apiKey_openai') || '',
    qwen: localStorage.getItem('apiKey_qwen') || '',
    deepseek: localStorage.getItem('apiKey_deepseek') || '',
    ncbi: localStorage.getItem('apiKey_ncbi') || '',
    elsevier: localStorage.getItem('apiKey_elsevier') || '',
  }));

  const handleApiKeyChange = (key, value) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
    localStorage.setItem(`apiKey_${key}`, value);
  };

  const handleConvert = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setStatusMessage(`Parsing citations with ${PROVIDERS[provider].name}...`);

    try {
      // 1. Convert to structured BibTeX objects
      const items = await convertToBibtex(input, provider, apiKeys);

      // 2. Validate & Check for Hallucinations
      setStatusMessage('Validating & Checking for Hallucinations...');
      const validatedItems = await validateCitations(items, apiKeys);

      setResults(validatedItems);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  const getFormattedOutput = () => {
    if (!results) return '';
    if (outputFormat === 'bibtex') return results.map(r => r.bibtex).join('\n\n');
    return results.map(r => formatCitation(r, outputFormat)).join('\n\n');
  };

  const handleCopy = () => {
    if (!results) return;
    navigator.clipboard.writeText(getFormattedOutput());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (dlFormat) => {
    if (!results) return;
    setShowDownloadMenu(false);
    let content, ext;
    if (dlFormat === 'ris') {
      content = buildRIS(results);
      ext = 'ris';
    } else if (dlFormat === 'nbib') {
      content = buildNBIB(results);
      ext = 'nbib';
    } else {
      content = results.map(r => r.bibtex).join('\n\n');
      ext = 'bib';
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `citations.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setResults(null);
    setError(null);
  };

  const getStatusColor = (status) => {
    if (status === 'valid') return 'text-slate-800'; // Black
    if (status === 'corrected') return 'text-orange-600'; // Orange
    return 'text-red-600'; // Red
  };

  const getCardStyle = (status) => {
    if (status === 'valid') return 'bg-white border-slate-200';
    if (status === 'corrected') return 'bg-orange-50 border-orange-200';
    return 'bg-red-50 border-red-200';
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            Literature to BibTeX
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Convert, Validate, and Detect Hallucinations.
            <span className="block text-sm mt-3 flex justify-center space-x-4">
              <span className="flex items-center text-slate-800"><Check className="w-3 h-3 mr-1" /> Valid (Black)</span>
              <span className="flex items-center text-orange-600 font-medium"><AlertTriangle className="w-3 h-3 mr-1" /> Auto-Corrected (Orange)</span>
              <span className="flex items-center text-red-600 font-medium"><AlertCircle className="w-3 h-3 mr-1" /> Not Found (Red)</span>
            </span>
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">

          {/* Edit Mode */}
          {!results && (
            <div className="p-6 md:p-10 flex flex-col min-h-[500px]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-semibold text-slate-700">LLM:</span>
                  <button
                    onClick={() => setProvider('gemini')}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${provider === 'gemini' ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Gemini
                  </button>
                  <button
                    onClick={() => setProvider('openai')}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${provider === 'openai' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    OpenAI
                  </button>
                  <button
                    onClick={() => setProvider('qwen')}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${provider === 'qwen' ? 'bg-purple-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Qwen
                  </button>
                  <button
                    onClick={() => setProvider('deepseek')}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${provider === 'deepseek' ? 'bg-cyan-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    DeepSeek
                  </button>
                </div>
                <button
                  onClick={() => setShowApiSettings(v => !v)}
                  className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-sm font-medium transition-colors ${showApiSettings ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
                >
                  <Settings className="w-4 h-4" />
                  <span>API Keys</span>
                </button>
              </div>

              {showApiSettings && (
                <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Only show the key for the selected provider */}
                  {provider === 'gemini' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Gemini API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={apiKeys.gemini}
                        onChange={e => handleApiKeyChange('gemini', e.target.value)}
                        placeholder="AIza..."
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>
                  )}
                  {provider === 'openai' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        OpenAI API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={apiKeys.openai}
                        onChange={e => handleApiKeyChange('openai', e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>
                  )}
                  {provider === 'qwen' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Qwen API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={apiKeys.qwen}
                        onChange={e => handleApiKeyChange('qwen', e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>
                  )}
                  {provider === 'deepseek' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        DeepSeek API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={apiKeys.deepseek}
                        onChange={e => handleApiKeyChange('deepseek', e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      NCBI API Key <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="password"
                      value={apiKeys.ncbi}
                      onChange={e => handleApiKeyChange('ncbi', e.target.value)}
                      placeholder="Optional"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Elsevier API Key <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="password"
                      value={apiKeys.elsevier}
                      onChange={e => handleApiKeyChange('elsevier', e.target.value)}
                      placeholder="Optional"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              )}
              <label htmlFor="input" className="block text-sm font-semibold text-slate-700 mb-3 flex items-center">
                <FileText className="w-4 h-4 mr-2 text-blue-500" />
                Input Source
              </label>
              <textarea
                id="input"
                className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none text-base leading-relaxed"
                placeholder="Paste citations, DOIs, or URLs here..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              {error && (
                <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl flex items-center">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {error}
                </div>
              )}
              <div className="mt-6">
                <button
                  onClick={handleConvert}
                  disabled={loading || !input.trim()}
                  className={`w-full py-4 px-6 rounded-xl flex items-center justify-center space-x-2 font-semibold text-white transition-all transform active:scale-[0.99] ${loading || !input.trim()
                      ? 'bg-slate-300 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200'
                    }`}
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>{statusMessage || 'Processing...'}</span>
                    </>
                  ) : (
                    <>
                      <BookOpen className="w-5 h-5" />
                      <span>Generate, Validate & Fix</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Report Mode */}
          {results && (
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 min-h-[600px]">

              {/* Left: Sources */}
              <div className="p-6 md:p-8 flex flex-col bg-slate-50/30">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Analysis</h3>
                  <button
                    onClick={reset}
                    className="text-sm text-blue-600 hover:underline font-medium"
                  >
                    Edit Input
                  </button>
                </div>
                <div className="space-y-4 overflow-auto flex-1 pr-2">
                  {results.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border ${getCardStyle(item.status)}`}
                    >
                      <p className={`text-sm font-medium ${getStatusColor(item.status)}`}>
                        {item.original || "(No original text captured)"}
                      </p>

                      {item.status === 'corrected' && (
                        <div className="mt-2 p-2 bg-orange-100 rounded text-xs text-orange-800">
                          <p className="font-semibold flex items-center"><AlertTriangle className="w-3 h-3 mr-1" /> Hallucination Detected & Fixed:</p>
                          <ul className="list-disc list-inside mt-1">
                            {item.mismatchDetails.map((d, i) => <li key={i}>{d}</li>)}
                          </ul>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.status !== 'invalid' ? (
                          <>
                            {item.sources.includes('NCBI') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">NCBI</span>
                            )}
                            {item.sources.includes('Scopus') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">Scopus</span>
                            )}
                            {(item.sources.includes('CrossRef') || item.sources.includes('CrossRef/Ref')) && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">CrossRef</span>
                            )}
                            {item.sources.includes('Semantic Scholar') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Semantic Scholar</span>
                            )}
                            {item.sources.includes('OpenAlex') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-800">OpenAlex</span>
                            )}
                            {item.sources.includes('dblp') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">dblp</span>
                            )}
                            {item.sources.includes('arXiv') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800">arXiv</span>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            Not Found in Databases
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Citation Output */}
              <div className="p-6 md:p-8 flex flex-col bg-slate-50/80">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-1">
                    {PRIMARY_FORMATS.map(key => (
                      <button
                        key={key}
                        onClick={() => { setOutputFormat(key); setShowOtherFormats(false); }}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${outputFormat === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {FORMAT_LABELS[key]}
                      </button>
                    ))}
                    <div className="relative">
                      <button
                        onClick={() => setShowOtherFormats(v => !v)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1 ${OTHER_FORMATS.includes(outputFormat) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        <span>{OTHER_FORMATS.includes(outputFormat) ? FORMAT_LABELS[outputFormat] : 'Other'}</span>
                        <span className="text-xs">▾</span>
                      </button>
                      {showOtherFormats && (
                        <>
                          <div className="fixed inset-0 z-0" onClick={() => setShowOtherFormats(false)} />
                          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1 min-w-36">
                            {OTHER_FORMATS.map(key => (
                              <button
                                key={key}
                                onClick={() => { setOutputFormat(key); setShowOtherFormats(false); }}
                                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 ${outputFormat === key ? 'text-blue-600 font-medium' : 'text-slate-700'}`}
                              >
                                {FORMAT_LABELS[key]}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleCopy}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Copy to Clipboard"
                    >
                      {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setShowDownloadMenu(v => !v)}
                        className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors flex items-center"
                        title="Download"
                      >
                        <Download className="w-5 h-5" />
                        <span className="text-xs leading-none ml-0.5">▾</span>
                      </button>
                      {showDownloadMenu && (
                        <>
                          <div className="fixed inset-0 z-0" onClick={() => setShowDownloadMenu(false)} />
                          <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1 min-w-32">
                            <button onClick={() => handleDownload('bib')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">BibTeX (.bib)</button>
                            <button onClick={() => handleDownload('ris')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">RIS (.ris)</button>
                            <button onClick={() => handleDownload('nbib')} className="block w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">NBIB (.nbib)</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`flex-1 rounded-xl border border-slate-200 bg-white p-4 overflow-auto text-sm leading-relaxed shadow-inner ${outputFormat === 'bibtex' ? 'font-mono' : 'font-sans'}`}>
                  {results.map((item, idx) => (
                    <div key={idx} className={`mb-6 ${getStatusColor(item.status)}`}>
                      {outputFormat === 'bibtex'
                        ? <pre className="whitespace-pre-wrap">{item.bibtex}</pre>
                        : <p className="whitespace-pre-wrap">{formatCitation(item, outputFormat)}</p>
                      }
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-400 text-sm">
          <p>© {new Date().getFullYear()} Literature Check. Powered by Gemini / OpenAI / Qwen / DeepSeek, NCBI & Scopus.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
