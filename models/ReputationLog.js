/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');

/**
 * Reputation event log.
 *
 * Stores immutable reputation changes for auditability,
 * anti-abuse analysis and dashboard aggregation.
 */
const ReputationLogSchema = new mongoose.Schema({
	target_profile_id: { // User who RECEIVES the reputation
		type: mongoose.Schema.Types.ObjectId,
		ref: 'Profile',
		required: true,
		index: true
	},
	source_profile_id: { // User who triggers the action (voter / moderator)
		type: mongoose.Schema.Types.ObjectId,
		ref: 'Profile',
		default: null
	},
	event_type: {
		type: String,
		enum: [
			'helpful_mark',
			'pinned',
			'correction',     
			'reply_received',
			'upvote',
			'downvote',
			'spam_report',
			'mod_removal'
		],
		required: true
	},
	entity_id: { // Related entity (comment or post)
		type: mongoose.Schema.Types.ObjectId,
		required: false
	},
	delta: { // Reputation delta applied (+10, -5, etc.)
		type: Number,
		required: true
	},
	trust_level_snapshot: { // Voter trust level at action time (audit purposes)
		type: Number,
		default: 0
	},
	created_at: {
		type: Date,
		default: Date.now,
		index: true // Critical for dashboard batch processing
	}
});

// Compound index for anti-brigading rules
// (limits repeated interactions between source and target over time)
ReputationLogSchema.index({
	source_profile_id: 1,
	target_profile_id: 1,
	created_at: -1
});

module.exports = mongoose.model('ReputationLog', ReputationLogSchema);
