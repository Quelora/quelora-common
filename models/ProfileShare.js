/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');

const profileShareSchema = new mongoose.Schema({
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
  created_at: {
    type: Date,
    default: Date.now,
  },
});

// Middleware para actualizar contadores
profileShareSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { sharesCount: 1 } }
  );
});

profileShareSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { sharesCount: -1 } }
  );
});


profileShareSchema.index({ profile_id: 1, post_id: 1 });
profileShareSchema.index({ profile_id: 1, created_at: -1 });
profileShareSchema.index({ post_id: 1, created_at: -1 });

module.exports = mongoose.model('ProfileShare', profileShareSchema);