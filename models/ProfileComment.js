/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');

const profileCommentSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  post_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
  },
  comment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileCommentSchema.index({ profile_id: 1, post_id: 1, comment_id: 1 });

// Middleware para actualizar contadores
profileCommentSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { commentsCount: 1 } }
  );
});

profileCommentSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { commentsCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileComment', profileCommentSchema);