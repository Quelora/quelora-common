/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/Stats.js

const { mongoose } = require('../db');

const statsSchema = new mongoose.Schema({
  cid: { 
    type: String,
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

const Stats = mongoose.model('Stats', statsSchema);

statsSchema.index({ timestamp: 1 });

module.exports = Stats;