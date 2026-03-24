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
