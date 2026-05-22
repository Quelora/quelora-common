/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/activityProcessorService.js */
const { mongoose } = require('../db');
const Activity = require('../models/Activity');
const { cacheClient } = require('./cacheService');
const { getActivityQueueKey } = require('./activityService');

const BATCH_SIZE = 500;
const MAX_LOOPS_PER_RUN = 5; // Reducido para no bloquear el worker mucho tiempo

const cleanReferences = (references = {}) => {
    const cleaned = {};
    const validFields = ['profileId', 'replyId', 'commentId', 'entity'];
    
    for (const field of validFields) {
        const value = references[field];
        if (value && mongoose.Types.ObjectId.isValid(value)) {
            cleaned[field] = value;
        }
    }
    return cleaned;
};

/**
 * Processes activity events for a specific tenant (CID).
 */
const processActivityQueue = async (cid) => {
    if (!cid) return { inserted: 0, batches: 0 };

    const queueKey = getActivityQueueKey(cid);
    let totalInserted = 0;
    let batches = 0;

    try {
        let loops = 0;
        let hasMore = true;

        while (hasMore && loops < MAX_LOOPS_PER_RUN) {
            const rawItems = await cacheClient.lRange(queueKey, 0, BATCH_SIZE - 1);

            if (!rawItems || rawItems.length === 0) {
                hasMore = false;
                break;
            }

            const validActivities = [];

            for (const item of rawItems) {
                try {
                    const data = JSON.parse(item);

                    if (!data.author?._id) continue;

                    validActivities.push({
                        cid: cid,
                        target_profile_id: data.targetProfile?._id || data.author._id,
                        profile_id: data.author._id,
                        picture: data.author.picture,
                        author_username: data.author.username,
                        author: data.author.author,
                        action_type: data.actionType,
                        references: cleanReferences(data.references),
                        created_at: new Date(data.timestamp || Date.now()),
                        target: data.target ? {
                            type: data.target.type,
                            id: data.target.id,
                            preview: data.target.preview ? data.target.preview.substring(0, 200) : '',
                            author: data.target.author
                        } : undefined
                    });
                } catch (e) {
                    console.error('[ActivityService] Parse error:', e);
                }
            }

            if (validActivities.length > 0) {
                await Activity.insertMany(validActivities, { ordered: false });
                totalInserted += validActivities.length;
            }

            await cacheClient.lTrim(queueKey, rawItems.length, -1);
            loops++;
            batches++;
        }

    } catch (error) {
        console.error(`[ActivityService] Batch Error for ${cid}:`, error);
        throw error;
    }

    return { inserted: totalInserted, batches };
};

module.exports = { processActivityQueue };