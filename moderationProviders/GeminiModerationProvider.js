/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const ModerationProvider = require('./ModerationProvider');

class GeminiModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson, cid) {
        super(apiKey, configJson, cid);
        this.providerName = 'Gemini';
        // Configuraciones por defecto para Gemini
        this.defaultConfig = {
            model: this.configJson.model || 'gemini-1.5-pro', // Modelo por defecto
            temperature: parseFloat(this.configJson.temperature || 0.7),
            maxOutputTokens: parseInt(this.configJson.maxOutputTokens || 1000, 10),
            topP: parseFloat(this.configJson.topP || 0.9),
            topK: parseInt(this.configJson.topK || 40, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para Gemini.');
        }

        // Instanciar el cliente Gemini
        this.gemini = new GoogleGenerativeAI(this.apiKey);
    }

    async _performModeration(prompt) {  
        const model = this.gemini.getGenerativeModel({
            model: this.defaultConfig.model,
            generationConfig: {
                temperature: this.defaultConfig.temperature,
                maxOutputTokens: this.defaultConfig.maxOutputTokens,
                topP: this.defaultConfig.topP,
                topK: this.defaultConfig.topK
            }
        });

        try {
            const response = await model.generateContent(prompt);
            const usageMetadata = response.response.usageMetadata;
            this.lastTokenUsage = {
                totalTokens: usageMetadata?.promptTokenCount + usageMetadata?.candidatesTokenCount || null,
                promptTokens: usageMetadata?.promptTokenCount || null,
                completionTokens: usageMetadata?.candidatesTokenCount || null
            };
            
            return response.response.text();
        } catch (error) {
            throw new Error(`Error en la moderación de Gemini: ${error.message}`);
        }
    }
}

module.exports = GeminiModerationProvider;