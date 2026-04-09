// Alias variants for model names used by LiteLLM proxies (e.g. university gateways)
// When the canonical name fails with a model-name error, these are tried in order
export const MODEL_ALIASES = {
    'gpt-4o':            ['openai.gpt-4o',       'openai/gpt-4o'],
    'gpt-4o-mini':       ['openai.gpt-4o-mini',  'openai/gpt-4o-mini'],
    'qwen-plus':         ['qwen/qwen-plus'],
    'qwen-turbo':        ['qwen/qwen-turbo'],
    'deepseek-chat':     ['deepseek/deepseek-chat'],
    'deepseek-reasoner': ['deepseek/deepseek-reasoner'],
};

export const PROVIDERS = {
    gemini: {
        name: 'Gemini',
        type: 'gemini',
        models: [
            'gemini-2.5-pro-preview-03-25',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
        ],
    },
    openai: {
        name: 'OpenAI',
        type: 'openai-compat',
        baseURL: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini'],
    },
    qwen: {
        name: 'Qwen',
        type: 'openai-compat',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-plus', 'qwen-turbo'],
    },
    deepseek: {
        name: 'DeepSeek',
        type: 'openai-compat',
        baseURL: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat', 'deepseek-reasoner'],
    },
};
