// Returns true only if the 403 is about this specific model being inaccessible
// (as opposed to a general auth/permission denial)
export function isModelAccessError(status, message) {
    if (status !== 403) return false;
    const m = (message || '').toLowerCase();
    return m.includes('model') || m.includes('eligible') || m.includes('permission') || m.includes('access');
}

// Returns true if the error is about model name format/routing (not key validity)
// e.g. LiteLLM proxies returning 401 "not allowed to access model gpt-4o, try openai.gpt-4o"
export function isModelNameError(status, message) {
    if (status !== 401 && status !== 404) return false;
    const m = (message || '').toLowerCase();
    return m.includes('not allowed to access model') ||
        m.includes('team can only access') ||
        m.includes('tried to access') ||
        m.includes('model not found') ||
        m.includes('no model') ||
        m.includes('does not exist');
}

// Maps raw errors to bilingual user-friendly messages
export function toFriendlyMessage(e, providerName, allModelsExhausted = false) {
    const status = e.status;
    const msg = (e.message || '').toLowerCase();

    if (e.type === 'key_missing') {
        return `未填写 ${providerName} API Key，请点击右上角「API Keys」按钮填入。\n${providerName} API key not entered — click "API Keys" at the top right to add it.`;
    }
    if (status === 401 || msg.includes('invalid api key') || msg.includes('incorrect api key') || msg.includes('authentication failed')) {
        return `${providerName} API Key 有误，请在「API Keys」面板中核查。\n${providerName} API key is incorrect — please check it in the "API Keys" panel.`;
    }
    if (status === 429) {
        return `${providerName} 请求太频繁或免费额度已用尽，请稍后再试或检查账户余额。\n${providerName} rate limit reached or free quota exhausted — please wait a moment or check your account balance.`;
    }
    if (status === 402) {
        return `${providerName} 账户余额不足，请充值后重试。\n${providerName} account balance is insufficient — please top up and try again.`;
    }
    if (allModelsExhausted) {
        return `${providerName} 所有可用模型均无访问权限，请确认账户已开通相关模型。\nAll ${providerName} models are inaccessible — please make sure your account has the required model access enabled.`;
    }
    if (!status || msg.includes('failed to fetch') || msg.includes('networkerror')) {
        return `无法连接到 ${providerName} 服务器，请检查网络连接。\nCannot reach ${providerName} — please check your internet connection.`;
    }
    return e.message; // fallback: show raw message as-is
}
