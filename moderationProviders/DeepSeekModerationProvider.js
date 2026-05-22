/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const OpenAI = require('openai');
const ModerationProvider = require('./ModerationProvider');

class DeepSeekModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson, cid) {
        super(apiKey, configJson, cid);
        this.providerName = 'DeepSeek';
        // Configuraciones por defecto para DeepSeek
        this.defaultConfig = {
            model: this.configJson.model || 'deepseek-chat', // Modelo por defecto (DeepSeek-V3)
            temperature: parseFloat(this.configJson.temperature || 0.7),
            max_tokens: parseInt(this.configJson.max_tokens || 1000, 10),
            max_retries: parseInt(this.configJson.max_retries || 3, 10),
            timeout: parseInt(this.configJson.timeout || 30000, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para DeepSeek.');
        }

        // Instanciar el cliente OpenAI con la URL base de DeepSeek
        this.openai = new OpenAI({
            apiKey: this.apiKey,
            baseURL: 'https://api.deepseek.com',
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
            throw new Error(`Error en la moderación de DeepSeek: ${error.message}`);
        }
    }
}

module.exports = DeepSeekModerationProvider;