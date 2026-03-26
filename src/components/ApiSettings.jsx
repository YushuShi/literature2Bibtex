export default function ApiSettings({ provider, apiKeys, onApiKeyChange }) {
  const keyField = (label, keyName, placeholder, focusColor = 'blue') => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="password"
        value={apiKeys[keyName] || ''}
        onChange={e => onApiKeyChange(keyName, e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-${focusColor}-500 focus:border-transparent outline-none`}
      />
    </div>
  );

  const baseURIField = (keyName, defaultURL) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        API Base URI <span className="text-slate-400">(optional)</span>
      </label>
      <input
        type="text"
        value={apiKeys[keyName] || ''}
        onChange={e => onApiKeyChange(keyName, e.target.value)}
        placeholder={defaultURL}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 font-mono focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none"
      />
    </div>
  );

  return (
    <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
      {provider === 'gemini' && keyField('Gemini API Key *', 'gemini', 'AIza...', 'blue')}
      {provider === 'openai' && (<>
        {keyField('OpenAI API Key *', 'openai', 'sk-...', 'emerald')}
        {baseURIField('openai_baseuri', 'https://api.openai.com/v1')}
      </>)}
      {provider === 'qwen' && (<>
        {keyField('Qwen API Key *', 'qwen', 'sk-...', 'purple')}
        {baseURIField('qwen_baseuri', 'https://dashscope.aliyuncs.com/compatible-mode/v1')}
      </>)}
      {provider === 'deepseek' && (<>
        {keyField('DeepSeek API Key *', 'deepseek', 'sk-...', 'cyan')}
        {baseURIField('deepseek_baseuri', 'https://api.deepseek.com/v1')}
      </>)}
      {keyField('NCBI API Key', 'ncbi', 'Optional')}
      {keyField('Elsevier API Key', 'elsevier', 'Optional')}
    </div>
  );
}
