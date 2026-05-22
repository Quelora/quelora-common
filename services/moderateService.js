/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// app/services/moderateService.js
const GrokModerationProvider = require('../moderationProviders/GrokModerationProvider');
const OpenAIModerationProvider = require('../moderationProviders/OpenAIModerationProvider');
const GeminiModerationProvider = require('../moderationProviders/GeminiModerationProvider');
const DeepSeekModerationProvider = require('../moderationProviders/DeepSeekModerationProvider');

async function moderateService(cid, text, clientModerationConfig) {
    let clientConfig;

    try {
        clientConfig = clientModerationConfig;

        if (!clientConfig || typeof clientConfig !== 'object') {
            throw new Error('Invalid or missing client moderation configuration.');
        }

        if (!clientConfig.hasOwnProperty('enabled') || !clientConfig.hasOwnProperty('provider')) {
            throw new Error('Incomplete client configuration: missing required properties (enabled, provider).');
        }

        if (clientConfig.config && typeof clientConfig.config === 'object' && !clientConfig.configJson) {
            clientConfig.configJson = JSON.stringify(clientConfig.config);
        }

    } catch (error) {
        console.error(`Error validating client moderation configuration:`, error.message);
        return { isRejected: null, reason: 'Error validating client moderation configuration.' };
    }

    if (!clientConfig.enabled) {
        return { isRejected: null, reason: 'Moderation disabled.' };
    }

    let provider;
    switch (clientConfig.provider) {
        case 'OpenAI':
            provider = new OpenAIModerationProvider(clientConfig.apiKey, clientConfig.configJson, cid);
            break;
        case 'Grok':
            provider = new GrokModerationProvider(clientConfig.apiKey, clientConfig.configJson, cid);
            break;
        case 'Gemini':
            provider = new GeminiModerationProvider(clientConfig.apiKey, clientConfig.configJson, cid);
            break;
        case 'Deep':
            provider = new DeepSeekModerationProvider(clientConfig.apiKey, clientConfig.configJson, cid);
            break;
        default:
            return { isRejected: null, reason: `Provider not supported: ${clientConfig.provider}` };
    }

    let prompt = clientConfig.prompt;
    if (clientConfig.prompt) {
        prompt = clientConfig.prompt.replace(/\{text\}/g, text);
    }

    try {
        const result = await provider.moderate(prompt);

        const isRejected = result.includes('Comment Rejected');
        return { isRejected, reason: result };
    } catch (error) {
        console.error(`Error moderating with the provider ${clientConfig.provider}:`, error.message);
        return { isRejected: null, reason: 'Error moderating with the provider.' };
    }
}

module.exports = { moderateService };