/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/tokenUsageService.js */
const { cacheClient } = require('./cacheService');
const TokenUsageModel = require('../models/TokenUsageStats');

/**
 * Scans Redis for temporary token usage keys and persists them to MongoDB.
 * Replaces the old tokenUsageRollupJob logic.
 */
async function runTokenUsageRollup() {
    const pattern = 'token_usage:*';
    let cursor = '0';
    let keysFound = 0;

    console.log('[TokenUsage] 🚀 Starting roll-up...');

    do {
        // Scan for keys
        const [nextCursor, keys] = await cacheClient.scan(
            cursor,
            'MATCH', pattern,
            'COUNT', 100
        );

        cursor = nextCursor;
        keysFound += keys.length;

        for (const key of keys) {
            try {
                const usageData = await cacheClient.hGetAll(key);
                // Key format: token_usage:CLIENT_ID
                const clientId = key.split(':')[1];
                
                if (!clientId || Object.keys(usageData).length === 0) {
                    await cacheClient.del(key);
                    continue;
                }
                
                const recordsToSave = {};

                for (const field in usageData) {
                    const value = parseInt(usageData[field]) || 0;
                    if (value === 0) continue;

                    // Field format: provider:model:metric
                    const parts = field.split(':');
                    if (parts.length < 3) continue;
                    
                    const provider = parts[0];
                    const model = parts[1];
                    const metric = parts[2];
                    
                    const recordKey = `${provider}:${model}`;
                    
                    if (!recordsToSave[recordKey]) {
                        recordsToSave[recordKey] = {
                            clientId: clientId,
                            provider: provider,
                            model: model,
                            taskType: 'moderation', // Default or derived
                            promptTokens: 0,
                            completionTokens: 0,
                            totalTokens: 0
                        };
                    }
                    
                    if (metric === 'promptTokens') recordsToSave[recordKey].promptTokens = value;
                    else if (metric === 'completionTokens') recordsToSave[recordKey].completionTokens = value;
                    else if (metric === 'totalTokens') recordsToSave[recordKey].totalTokens = value;
                }

                const dbInserts = Object.values(recordsToSave)
                    .filter(rec => rec.totalTokens > 0);

                if (dbInserts.length > 0) {
                    // Bulk create for efficiency
                    await TokenUsageModel.insertMany(dbInserts);
                }
                
                // Clear processed key
                await cacheClient.del(key);
            
            } catch (procError) {
                console.error(`[TokenUsage] ❌ Error processing key ${key}:`, procError);
            }
        }
    } while (cursor !== '0');
    
    if (keysFound > 0) {
        console.log(`[TokenUsage] ✅ Processed ${keysFound} client keys.`);
    }
    return { keysProcessed: keysFound };
}

module.exports = { runTokenUsageRollup };