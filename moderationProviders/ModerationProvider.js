/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./moderationProviders/ModerationProvider.js

const { cacheClient } = require('../services/cacheService');

class ModerationProvider {
    constructor(apiKey, configJson, cid) { 
        this.apiKey = apiKey;
        this.cid = cid;

        try {
            this.configJson = typeof configJson === 'string' && configJson.trim() ? JSON.parse(configJson) : configJson || {};
        } catch (error) {
            console.error('Error parsing configJson:', error.message);
            this.configJson = {};
        }
        
        this.lastTokenUsage = {
            totalTokens: null,
            promptTokens: null,
            completionTokens: null
        };
    }
    
    async logTokenUsage(providerName, taskType = 'moderation') {
        const modelName = this.defaultConfig ? this.defaultConfig.model : 'unknown-model';
        
        if (this.lastTokenUsage.totalTokens > 0 && this.cid) {
            try {
                const redisKey = `token_usage:${this.cid}`;
                
                const baseField = `${providerName}:${modelName}`;
                
                await Promise.all([
                    cacheClient.hIncrBy(redisKey, `${baseField}:promptTokens`, this.lastTokenUsage.promptTokens || 0),
                    cacheClient.hIncrBy(redisKey, `${baseField}:completionTokens`, this.lastTokenUsage.completionTokens || 0),
                    cacheClient.hIncrBy(redisKey, `${baseField}:totalTokens`, this.lastTokenUsage.totalTokens || 0)
                ]);
                
            } catch (redisError) {
                console.error(`Error al acumular uso de tokens en Redis (HINCRBY) para el CID ${this.cid}:`, redisError.message);
            }
        }
    }

    getLastTokenUsage() {
        return this.lastTokenUsage;
    }

    async moderate(prompt, type = 'moderation') {
        const providerName = this.providerName || this.constructor.name.replace('ModerationProvider', ''); 
        const result = await this._performModeration(prompt);
        await this.logTokenUsage(providerName, type); 
        return result;
    }
    
    async _performModeration(prompt) {
        throw new Error('_performModeration must be implemented by the provider subclass.');
    }
    
    async analyze(prompt, type = 'moderation') {
        return await this.moderate(prompt, type);
    }
}

module.exports = ModerationProvider;