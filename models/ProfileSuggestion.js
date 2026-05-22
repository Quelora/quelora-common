/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');

const suggestionItemSchema = new mongoose.Schema({
    target_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    score: { type: Number, required: true },
    reason: { type: String, enum: ['location', 'social', 'interest', 'popular'], default: 'social' },
    common_connections: { type: Number, default: 0 },
    mutual_friend_ids: [{ 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile' 
    }]
}, { _id: false });

const profileSuggestionSchema = new mongoose.Schema({
    profile_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        required: true,
        unique: true // Una lista de sugerencias por usuario
    },
    suggestions: [suggestionItemSchema],
    updated_at: { type: Date, default: Date.now }
});

profileSuggestionSchema.index({ profile_id: 1 });
profileSuggestionSchema.index({ updated_at: 1 }); // Para saber cuáles están obsoletos

module.exports = mongoose.model('ProfileSuggestion', profileSuggestionSchema);