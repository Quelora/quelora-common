/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/TokenUsageStats.js

const { mongoose } = require('../db');

const tokenUsageSchema = new mongoose.Schema({
    clientId: { 
        type: String,
        required: true,
        index: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
    provider: {
        type: String,
        required: true,
        index: true
    },
    promptTokens: {
        type: Number,
        required: true,
        default: 0
    },
    completionTokens: {
        type: Number,
        required: true,
        default: 0
    },
    totalTokens: {
        type: Number,
        required: true,
        default: 0
    },
    taskType: {
        type: String,
        default: 'moderation' 
    }
});

tokenUsageSchema.index({ timestamp: 1 });
tokenUsageSchema.index({ clientId: 1, timestamp: -1 });
tokenUsageSchema.index({ provider: 1, model: 1 });

const TokenUsageStats = mongoose.model('TokenUsageStats', tokenUsageSchema);

module.exports = TokenUsageStats;