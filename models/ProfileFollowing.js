/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./app/models/ProfileFollowing.js
const { mongoose } = require('../db');

/**
 * @typedef {Object} ProfileFollowingDocument
 * @property {mongoose.Types.ObjectId} profile_id   - The profile that is following.
 * @property {mongoose.Types.ObjectId} following_id - The profile being followed.
 * @property {Date} created_at - Timestamp of the follow action.
 */

/**
 * Mongoose schema representing the outbound side of a follow relationship.
 *
 * Index strategy:
 *
 * 1. `{ profile_id: 1, following_id: 1 }` — Covers the canonical direction:
 *    "is profile X following Y?" and all pagination queries anchored on
 *    `profile_id` (following list, existence checks, `searchNewFollowers`
 *    post-filter).
 *
 * 2. `{ profile_id: 1, _id: -1 }` — Covers keyset-paginated following lists:
 *    `find({ profile_id }).sort({ _id: -1 }).limit(n)` and the outer stage of
 *    the `getMutuals` aggregation pipeline.
 *
 * 3. `{ following_id: 1, profile_id: 1 }` — Covers the **inverse direction**
 *    queries executed inside `hydrateUserRelations`:
 *
 *      - `find({ follower_id: myId,          profile_id: { $in: targetIds } })`
 *        (resolved against ProfileFollower, but the symmetric pattern applies
 *        here for any inverse lookup on the following side)
 *
 *    Also covers the `$lookup` inner pipeline of `getMutuals` in MongoDB >= 5.0,
 *    where `$expr`-based lookups can leverage a compound index when the join
 *    field is the leading key:
 *
 *      `{ $eq: ['$follower_id', '$$target_id'] }` resolves via this index
 *      when `following_id` is the outer variable being matched.
 */
const profileFollowingSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  following_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

/** Canonical direction: "who is profile X following?" and existence checks. */
profileFollowingSchema.index({ profile_id: 1, following_id: 1 });

/** Keyset pagination over following list sorted by insertion order. */
profileFollowingSchema.index({ profile_id: 1, _id: -1 });

/**
 * Inverse direction: "which profiles are following target Y?".
 * Covers inverse hydration queries and the getMutuals $lookup inner pipeline
 * on MongoDB >= 5.0.
 */
profileFollowingSchema.index({ following_id: 1, profile_id: 1 });

/**
 * Increments the `followingCount` denormalised counter on the source profile
 * after a new following relationship is persisted.
 *
 * @param {ProfileFollowingDocument} doc - The saved document.
 */
profileFollowingSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followingCount: 1 } }
  );
});

/**
 * Decrements the `followingCount` denormalised counter on the source profile
 * after a following relationship document is deleted.
 *
 * @param {ProfileFollowingDocument} doc - The deleted document.
 */
profileFollowingSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followingCount: -1 } }
  );
});

/**
 * Checks whether `profileId` is currently following `followingId`.
 *
 * @param {mongoose.Types.ObjectId|string} profileId   - The source profile ID.
 * @param {mongoose.Types.ObjectId|string} followingId - The target profile ID.
 * @returns {Promise<boolean>} `true` if the relationship exists.
 */
profileFollowingSchema.statics.isFollowing = async function (profileId, followingId) {
  if (!profileId || !followingId) return false;
  const existing = await this.exists({
    profile_id: profileId,
    following_id: followingId,
  });
  return !!existing;
};

module.exports = mongoose.model('ProfileFollowing', profileFollowingSchema);