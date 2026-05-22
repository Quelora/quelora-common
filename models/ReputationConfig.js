/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// models/ReputationConfig.js
const { mongoose } = require('../db');

const ReputationConfigSchema = new mongoose.Schema({
    cid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    weights: {
        helpful_mark: { type: Number, default: 10 },
        pinned: { type: Number, default: 50 },
        correction: { type: Number, default: 20 },
        upvote: { type: Number, default: 1 },
        downvote: { type: Number, default: -2 },
        spam_report: { type: Number, default: -50 },
        mod_removal: { type: Number, default: -100 },
        post_created: { type: Number, default: 0 }, 
        reply_created: { type: Number, default: 0 } 
    },
    trust_levels: [{
        lvl: { type: Number, required: true },
        min: { type: Number, required: true },
        label: { type: String }
    }],
    limits: {
        max_daily_reputation_gain: { type: Number, default: 100 },
        decay_rate: { type: Number, default: 0.05 }
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('ReputationConfig', ReputationConfigSchema);