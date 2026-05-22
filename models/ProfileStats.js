/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/ProfileStats.js
const { mongoose } = require('../db');

const profileStatsSchema = new mongoose.Schema({
    cid: { 
        type: String,
        required: true,
        index: true 
    },
    profileId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Profile', 
        required: true,
        index: true 
    },
    author: {
        type: String,
        required: true,
        index: true
    },
    date: {
        type: Date,
        required: true,
    },
    commentsAdded: {
        type: Number,
        default: 0,
    },
    repliesAdded: {
        type: Number,
        default: 0,
    },
    likesGiven: {
        type: Number,
        default: 0,
    },
    sharesGiven: {
        type: Number,
        default: 0,
    },
    likesReceived: {
        type: Number,
        default: 0,
    },
    repliesReceived: {
        type: Number,
        default: 0,
    },
    toxicityScoreAvg: {
        type: Number,
        default: 0,
    },
    postsViewed: {
        type: Number,
        default: 0,
    },
    aggregationType: {
        type: String,
        default: 'hourly', 
    }
});

profileStatsSchema.index({ cid: 1, profileId: 1, date: 1 }, { unique: true });

const ProfileStats = mongoose.model('ProfileStats', profileStatsSchema);

module.exports = ProfileStats;