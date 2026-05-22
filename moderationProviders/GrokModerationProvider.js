/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const OpenAI = require('openai');
const ModerationProvider = require('./ModerationProvider');

class GrokModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson, cid) {
        super(apiKey, configJson, cid);
        this.providerName = 'Grok';
        // Configuraciones por defecto para Grok
        this.defaultConfig = {
            model: this.configJson.model || 'grok-3-beta',
            temperature: parseFloat(this.configJson.temperature || 0.7),
            max_tokens: parseInt(this.configJson.max_tokens || 1000, 10),
            max_retries: parseInt(this.configJson.max_retries || 3, 10),
            timeout: parseInt(this.configJson.timeout || 30000, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para Grok.');
        }

        // Instanciar el cliente OpenAI con la URL base de xAI
        this.openai = new OpenAI({
            apiKey: this.apiKey,
            baseURL: 'https://api.x.ai/v1',
            maxRetries: this.defaultConfig.max_retries,
            timeout: this.defaultConfig.timeout
        });
    }

    async _performModeration(prompt) {  
        const chatBotParams = {
            messages: [{ role: 'user', content: prompt }],
            model: this.defaultConfig.model,
            temperature: this.defaultConfig.temperature,
            max_tokens: this.defaultConfig.max_tokens
        };

        try {
            const response = await this.openai.chat.completions.create(chatBotParams);
            const usage = response.usage;
            this.lastTokenUsage = {
                totalTokens: usage ? usage.total_tokens : null,
                promptTokens: usage ? usage.prompt_tokens : null,
                completionTokens: usage ? usage.completion_tokens : null
            };
            return response.choices[0].message.content;
        } catch (error) {
            throw new Error(`Error en la moderación de Grok: ${error.message}`);
        }
    }
}

module.exports = GrokModerationProvider;