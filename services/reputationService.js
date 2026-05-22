/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/reputationService.js */
const { cacheClient } = require('./cacheService');
const crypto = require('crypto');

const REPUTATION_QUEUE_KEY = 'queue:reputation:events';

/**
 * Queues a reputation event to Redis for asynchronous processing.
 * Includes UUID for idempotency and Quality Score for weighted calculation.
 * * @param {Object} params
 * @param {string} params.cid - Client ID (Tenant)
 * @param {string|ObjectId} params.target_profile_id - The profile receiving the score
 * @param {string|ObjectId} [params.source_profile_id] - The actor (optional, null for system events)
 * @param {string} params.event_type - Type of action (e.g., 'upvote', 'post_created')
 * @param {string|ObjectId} params.entity_id - Reference ID (Post/Comment)
 * @param {number} params.source_trust_level - Trust level of the actor (0-5)
 * @param {number} [params.quality_score] - Content quality factor (0.0 - 1.0)
 */
const queueReputationEvent = async ({ cid, target_profile_id, source_profile_id, event_type, entity_id, source_trust_level, quality_score }) => {
    try {
        if (!cid || !target_profile_id) return;

        if (source_profile_id && target_profile_id.toString() === source_profile_id.toString()) return;

        const event = JSON.stringify({
            eventId: crypto.randomUUID(),
            cid,
            target: target_profile_id,
            source: source_profile_id,
            type: event_type,
            entity: entity_id,
            lvl: source_trust_level || 0,
            quality: typeof quality_score === 'number' ? quality_score : undefined,
            ts: Date.now()
        });

        await cacheClient.lPush(REPUTATION_QUEUE_KEY, event);
    } catch (error) {
        console.error('[ReputationService] Failed to queue event:', error.message);
    }
};

module.exports = { queueReputationEvent, REPUTATION_QUEUE_KEY };