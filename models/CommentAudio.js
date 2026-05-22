/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

  const { mongoose } = require('../db');

  const commentAudioSchema = new mongoose.Schema({
    comment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      required: true, 
    },
    audioData: {
      type: String,
      required: true
    },
    created_at: {
      type: Date,
      default: Date.now
    }
  });

  module.exports = mongoose.model('CommentAudio', commentAudioSchema);