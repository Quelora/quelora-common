/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/models/JobExecutionLog.js */
const { mongoose } = require('../db');

const jobExecutionLogSchema = new mongoose.Schema({
    jobName: { type: String, required: true, index: true },
    queueName: { type: String },
    cid: { type: String, index: true },
    bullJobId: { type: String, required: true, index: true },
    status: { 
        type: String, 
        enum: ['active', 'completed', 'failed'],
        default: 'active' 
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    durationMs: { type: Number },
    
    error: {
        message: String,
        stack: String
    },
    
    metadata: { type: mongoose.Schema.Types.Mixed }
}, { 
    timestamps: true // Keeps createdAt and updatedAt
});

// INDEXES
// 1. For quick searches by client and date
jobExecutionLogSchema.index({ cid: 1, startedAt: -1 });

// 2. TTL (Time To Live): Auto-delete logs after 7 days (604800 seconds)
// This replaces the "Capped" functionality but allows updates.
jobExecutionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('JobExecutionLog', jobExecutionLogSchema);