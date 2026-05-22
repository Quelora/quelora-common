/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./app/models/ProfileFollower.js
const { mongoose } = require('../db');

/**
 * @typedef {Object} ProfileFollowerDocument
 * @property {mongoose.Types.ObjectId} profile_id  - The profile being followed.
 * @property {mongoose.Types.ObjectId} follower_id - The profile that is following.
 * @property {Date} created_at - Timestamp of the follow action.
 */

/**
 * Mongoose schema representing a unidirectional follower relationship.
 *
 * Index strategy:
 *
 * 1. `{ profile_id: 1, follower_id: 1 }` — Covers the canonical direction:
 *    "does X follow profile Y?" and all pagination queries that start from a
 *    known `profile_id` (followers list, existence checks).
 *
 * 2. `{ profile_id: 1, _id: -1 }` — Covers keyset-paginated follower lists:
 *    `find({ profile_id }).sort({ _id: -1 }).limit(n)`.
 *
 * 3. `{ follower_id: 1, profile_id: 1 }` — Covers the **inverse direction**
 *    queries executed on every call to `hydrateUserRelations`:
 *
 *      - `find({ follower_id: myId,           profile_id: { $in: targetIds } })`
 *      - `find({ follower_id: { $in: ids },   profile_id: myId             })`
 *
 *    Without this index both queries degrade to index scans over `profile_id`
 *    entries, which are unbounded when the set of followers is large.
 *    `hydrateUserRelations` is invoked on every followers list, following list,
 *    suggestions batch, activity feed and search result, making this a hot path.
 */
const profileFollowerSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  follower_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

/** Canonical direction: "who follows profile X?" and existence checks. */
profileFollowerSchema.index({ profile_id: 1, follower_id: 1 });

/** Keyset pagination over followers list sorted by insertion order. */
profileFollowerSchema.index({ profile_id: 1, _id: -1 });

/**
 * Inverse direction: "which of these profiles does follower X follow?" and
 * "which of these followers follow profile X?".
 * Critical for hydrateUserRelations — called on every enriched list response.
 */
profileFollowerSchema.index({ follower_id: 1, profile_id: 1 });

/**
 * Increments the `followersCount` denormalised counter on the target profile
 * after a new follower relationship is persisted.
 *
 * @param {ProfileFollowerDocument} doc - The saved document.
 */
profileFollowerSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followersCount: 1 } }
  );
});

/**
 * Decrements the `followersCount` denormalised counter on the target profile
 * after a follower relationship document is deleted.
 *
 * @param {ProfileFollowerDocument} doc - The deleted document.
 */
profileFollowerSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followersCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileFollower', profileFollowerSchema);