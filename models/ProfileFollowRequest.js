/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./app/models/ProfileFollowRequest.js
const { mongoose } = require('../db');

/**
 * @typedef {Object} ProfileFollowRequestDocument
 * @property {mongoose.Types.ObjectId} profile_id - The profile that sent the follow request.
 * @property {mongoose.Types.ObjectId} target_id  - The profile that received the follow request.
 * @property {'pending'|'approved'|'rejected'} status - Current status of the request.
 * @property {Date} created_at    - Timestamp of request creation.
 * @property {Date} [responded_at] - Timestamp when the request was acted upon.
 */

/**
 * Mongoose schema for follow requests between profiles.
 *
 * Index strategy:
 *
 * 1. `{ profile_id: 1, target_id: 1 }` — Covers the uniqueness check before creating a
 *    new request and the cancellation flow (`deleteOne({ profile_id, target_id })`).
 *
 * 2. `{ profile_id: 1, target_id: 1, status: 1 }` — Covers the existence check with
 *    status filter: `exists({ profile_id, target_id, status: 'pending' })`.
 *
 * 3. `{ target_id: 1, status: 1 }` — Covers the inbox query executed on every session
 *    profile load: `find({ target_id: profile._id, status: 'pending' })`.
 *    Without this index that query performs a full collection scan because `target_id`
 *    is never a prefix in the other two indexes.
 */
const profileFollowRequestSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  target_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  responded_at: {
    type: Date,
  },
});

/** Uniqueness check and cancellation flow. */
profileFollowRequestSchema.index({ profile_id: 1, target_id: 1 });

/** Pending-status existence check (is a request already in flight?). */
profileFollowRequestSchema.index({ profile_id: 1, target_id: 1, status: 1 });

/**
 * Inbox query on every session profile load.
 * `find({ target_id: <id>, status: 'pending' })` — previously a guaranteed
 * collection scan; now covered as a targeted index seek.
 */
profileFollowRequestSchema.index({ target_id: 1, status: 1 });

module.exports = mongoose.model('ProfileFollowRequest', profileFollowRequestSchema);