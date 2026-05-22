/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');

const profileNotInterestedSchema = new mongoose.Schema({
    profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    target_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    created_at: { type: Date, default: Date.now, expires: '90d' } // TTL: Se olvida a los 3 meses
});

profileNotInterestedSchema.index({ profile_id: 1, target_id: 1 }, { unique: true });

module.exports = mongoose.model('ProfileNotInterested', profileNotInterestedSchema);