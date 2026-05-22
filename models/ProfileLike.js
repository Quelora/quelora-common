/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./app/models/ProfileLike.js
const { mongoose } = require('../db');

const profileLikeSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  fk_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  fk_type: {
    type: String,
    enum: ['post', 'comment'],
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});



profileLikeSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { likesCount: 1 } }
  );
});

profileLikeSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { likesCount: -1 } }
  );
});

profileLikeSchema.index({ profile_id: 1, fk_type: 1, fk_id: 1 });   //What did this user like?
profileLikeSchema.index({ fk_id: 1, fk_type: 1, created_at: -1 });  //Who liked this post?
profileLikeSchema.index({ profile_id: 1, created_at: -1 });         //Give me the latest likes from this user" without ordering in memory
profileLikeSchema.index({ profile_id: 1, _id: -1 });

module.exports = mongoose.model('ProfileLike', profileLikeSchema);