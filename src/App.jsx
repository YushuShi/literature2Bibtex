import React, { useState } from 'react';
import { BookOpen, Copy, Download, RefreshCw, FileText, Check, AlertCircle, AlertTriangle } from 'lucide-react';
import { convertToBibtex } from './utils/bibtexConverter';
import { validateCitations } from './utils/citationValidator';

function App() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleConvert = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setStatusMessage('Parsing citations with Gemini...');

    try {
      // 1. Convert to structured BibTeX objects
      const items = await convertToBibtex(input);

      // 2. Validate & Check for Hallucinations
      setStatusMessage('Validating & Checking for Hallucinations...');
      const validatedItems = await validateCitations(items);

      setResults(validatedItems);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  const handleCopy = () => {
    if (!results) return;
    const allBibtex = results.map(r => r.bibtex).join('\n\n');
    navigator.clipboard.writeText(allBibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!results) return;
    const allBibtex = results.map(r => r.bibtex).join('\n\n');
    const blob = new Blob([allBibtex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'citations.bib';
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
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                NCBI
                              </span>
                            )}
                            {item.sources.includes('Scopus') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                Scopus
                              </span>
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

              {/* Right: BibTeX */}
              <div className="p-6 md:p-8 flex flex-col bg-slate-50/80">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">BibTeX Output</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleCopy}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Copy to Clipboard"
                    >
                      {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Download .bib"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 overflow-auto font-mono text-sm leading-relaxed shadow-inner">
                  {results.map((item, idx) => (
                    <div key={idx} className={`mb-6 ${getStatusColor(item.status)}`}>
                      <pre className="whitespace-pre-wrap">{item.bibtex}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-400 text-sm">
          <p>© {new Date().getFullYear()} Literature Check. Powered by Gemini, NCBI & Scopus.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
