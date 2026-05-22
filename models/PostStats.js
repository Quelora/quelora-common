/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// models/PostStats.js

const { mongoose } = require('../db');

const postStatsSchema = new mongoose.Schema({
  cid: { 
    type: String,
    required: true,
    index: true
  },
  entity: {
    type: mongoose.Schema.Types.ObjectId, // Referencia al Post (Entity)
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  likesAdded: {
    type: Number,
    default: 0,
  },
  likesRemoved: {
    type: Number,
    default: 0,
  },
  sharesAdded: {
    type: Number,
    default: 0,
  },
  commentsAdded: {
    type: Number,
    default: 0,
  },
  repliesAdded: {
    type: Number,
    default: 0,
  },
});

postStatsSchema.index({ cid: 1, entity: 1, timestamp: 1 }, { unique: false });
postStatsSchema.index({ timestamp: 1 });

const PostStats = mongoose.model('PostStats', postStatsSchema);

module.exports = PostStats;