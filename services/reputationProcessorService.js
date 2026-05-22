/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/reputationProcessorService.js */
const { mongoose } = require('../db');
const Profile = require('../models/Profile');
const ReputationLog = require('../models/ReputationLog');
const ReputationConfig = require('../models/ReputationConfig');
const { cacheClient, cacheService } = require('./cacheService');
const { REPUTATION_QUEUE_KEY } = require('./reputationService');
const { deleteProfileCache } = require('./profileService');

const BATCH_SIZE = 500;
const DEDUP_TTL = 86400; // 24 Hours

// ============================================================================
// DEFAULT CONFIGURATION FALLBACKS
// These values are used ONLY if the Dashboard (Database) configuration is missing.
// ============================================================================

/**
 * Default Source Rewards (Actor Incentives).
 * Points awarded to the user performing the action.
 */
const DEFAULT_ACTION_REWARDS = {
    upvote_given: 0.01,
    reply_created: 0.05,
    post_created: 0.10,
    share_given: 0.05
};

/**
 * Default Voting Power Multipliers (Proof of Stake).
 * Determines how much a user's vote counts based on their level.
 */
const DEFAULT_MULTIPLIERS = {
    LIKES: {
        LVL_0: 0.001,
        LVL_1: 0.05,
        LVL_2: 0.10,
        LVL_3: 1.00,
        LVL_4: 1.50,
        LVL_5: 2.00
    }
};

/**
 * Default Trust Level Thresholds.
 */
const DEFAULT_LEVELS = [
    { lvl: 0, min: -Infinity },
    { lvl: 1, min: 0 },
    { lvl: 2, min: 50 },
    { lvl: 3, min: 200 },
    { lvl: 4, min: 1000 },
    { lvl: 5, min: 5000 }
];

/**
 * Default Safety Limits (Caps).
 */
const DEFAULT_LIMITS = {
    max_daily_reputation_gain: 100
};

/**
 * Default Target Weights (Recipient Rewards).
 */
const DEFAULT_WEIGHTS = {
    post_created: 0.005,
    reply_created: 0.005,
    upvote: 1.0,
    downvote: -2.0,
    reply_received: 0.5
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a reputation event has already been processed to prevent duplication.
 * @param {string} eventId - Unique event identifier.
 * @returns {Promise<boolean>}
 */
const isEventProcessed = async (eventId) => {
    if (!eventId) return false;
    const exists = await cacheClient.exists(`dedup:reputation:${eventId}`);
    return exists === 1;
};

/**
 * Marks a reputation event as processed in Redis.
 * @param {string} eventId - Unique event identifier.
 */
const markEventProcessed = async (eventId) => {
    if (!eventId) return;
    await cacheClient.set(`dedup:reputation:${eventId}`, '1', 'EX', DEDUP_TTL);
};

/**
 * Calculates the exact reputation delta for an event.
 * Uses the dynamic configuration loaded from DB/Dashboard.
 * @param {Object} event - The event payload.
 * @param {Object} config - The resolved configuration for the CID.
 * @returns {number} The calculated score change.
 */
const calculateMicroDelta = (event, config) => {
    const { type, lvl, quality = 0, custom_delta } = event;
    
    // Merge defaults with dynamic config to ensure no undefined values
    const weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    const multipliers = config.multipliers && config.multipliers.LIKES 
        ? config.multipliers 
        : DEFAULT_MULTIPLIERS;

    // 1. Explicit Override Strategy
    if (custom_delta !== undefined && custom_delta !== null) {
        let val = parseFloat(custom_delta);
        return isNaN(val) ? 0 : val;
    }

    // 2. Event Type Strategy
    switch (type) {
        case 'post_created':
            return quality < 0.3 ? 0 : (quality * (weights.post_created || 0));

        case 'reply_created':
            return quality < 0.3 ? 0 : (quality * (weights.reply_created || 0));

        case 'reply_received':
            const baseVal = weights.reply_received !== undefined ? weights.reply_received : (weights.upvote * 0.5);
            return quality < 0.3 ? 0 : (quality * baseVal);

        case 'upvote':
            const baseVote = weights.upvote || 1;
            // Use Dynamic Multipliers from Config
            const m = multipliers.LIKES;
            if (lvl < 1) return baseVote * (m.LVL_0 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_0);
            if (lvl === 1) return baseVote * (m.LVL_1 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_1);
            if (lvl === 2) return baseVote * (m.LVL_2 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_2);
            if (lvl === 3) return baseVote * (m.LVL_3 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_3);
            if (lvl === 4) return baseVote * (m.LVL_4 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_4);
            return baseVote * (m.LVL_5 ?? DEFAULT_MULTIPLIERS.LIKES.LVL_5);

        case 'downvote':
            if (lvl < 1) return 0; 
            return weights.downvote;

        default:
            return weights[type] || 0;
    }
};

/**
 * Determines the Trust Level based on the current score and configured thresholds.
 * @param {number} score - The user's total reputation score.
 * @param {Array} levels - Array of level definitions.
 * @returns {number} The calculated level.
 */
const getTrustLevel = (score, levels) => {
    const sortedLevels = levels.sort((a, b) => a.min - b.min);
    for (let i = sortedLevels.length - 1; i >= 0; i--) {
        if (score >= sortedLevels[i].min) return sortedLevels[i].lvl;
    }
    return 0;
};

/**
 * Helper to aggregate score updates for batch processing.
 * @param {Object} updatesMap - Map of profile updates.
 * @param {string} profileId - User ID.
 * @param {string} cid - Client ID.
 * @param {number} delta - Points to add.
 */
const accumulateDelta = (updatesMap, profileId, cid, delta) => {
    if (!profileId) return;
    const pid = profileId.toString();
    if (!updatesMap[pid]) {
        updatesMap[pid] = { delta: 0, cid: cid };
    }
    updatesMap[pid].delta += delta;
};

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

/**
 * Main Reputation Processor.
 * Reads events, loads dynamic config from Dashboard/DB, calculates rewards for 
 * both Target (Receiver) and Source (Actor), and updates profiles.
 */
exports.processReputationQueue = async () => {
    const rawEvents = await cacheClient.lrange(REPUTATION_QUEUE_KEY, 0, BATCH_SIZE - 1);
    if (!rawEvents || rawEvents.length === 0) return;

    try {
        const events = rawEvents.map(e => JSON.parse(e));
        const uniqueCids = [...new Set(events.map(e => e.cid).filter(Boolean))];
        const configMap = {};
        
        // 2. Load Dynamic Configuration (Dashboard Controlled)
        for (const cid of uniqueCids) {
            const cacheKey = `config:reputation:${cid}`;
            let conf = await cacheService.get(cacheKey);
            
            if (!conf) {
                const doc = await ReputationConfig.findOne({ cid }).lean();
                
                // Merge DB values with Defaults to guarantee structural integrity
                conf = {
                    weights: { ...DEFAULT_WEIGHTS, ...doc?.weights },
                    levels: doc?.trust_levels?.length ? doc.trust_levels : DEFAULT_LEVELS,
                    limits: { ...DEFAULT_LIMITS, ...doc?.limits },
                    // Load dynamic multipliers and actor rewards from DB if they exist
                    multipliers: { ...DEFAULT_MULTIPLIERS, ...doc?.multipliers }, 
                    source_rewards: { ...DEFAULT_ACTION_REWARDS, ...doc?.source_rewards }
                };
                
                await cacheService.set(cacheKey, conf, 3600);
            }
            configMap[cid] = conf;
        }

        const logsToInsert = [];
        const updatesByProfile = {};
        const processedEventIds = [];

        // 3. Process Events
        for (const event of events) {
            if (event.eventId && await isEventProcessed(event.eventId)) continue;

            const cid = event.cid;
            if (!cid) continue;

            const config = configMap[cid];
            const cap = config.limits.max_daily_reputation_gain || 100;

            // --- A. TARGET REWARD (Recipient Logic) ---
            let targetDelta = calculateMicroDelta(event, config);
            
            if (Math.abs(targetDelta) > cap) {
                targetDelta = Math.sign(targetDelta) * cap;
            }

            if (targetDelta !== 0 && event.target) {
                accumulateDelta(updatesByProfile, event.target, cid, targetDelta);
                
                logsToInsert.push({
                    target_profile_id: event.target,
                    source_profile_id: event.source,
                    event_type: event.type,
                    entity_id: event.entity,
                    delta: targetDelta,
                    trust_level_snapshot: event.lvl,
                    created_at: new Date(event.ts)
                });
            }

            // --- B. SOURCE REWARD (Actor Logic) ---
            // Now uses Dynamic Config with Default Fallback
            if (event.source) {
                let actorDelta = 0;
                let actorEventType = null;
                const rewards = config.source_rewards; // Dynamic Config

                if (event.type === 'upvote') {
                    actorDelta = rewards.upvote_given ?? DEFAULT_ACTION_REWARDS.upvote_given;
                    actorEventType = 'upvote_given';
                } 
                else if (event.type === 'reply_received' || event.type === 'reply_created') {
                    actorDelta = rewards.reply_created ?? DEFAULT_ACTION_REWARDS.reply_created;
                    actorEventType = 'reply_created';
                }
                else if (event.type === 'post_created') {
                    actorDelta = rewards.post_created ?? DEFAULT_ACTION_REWARDS.post_created;
                    actorEventType = 'post_created';
                }
                else if (event.type === 'share' || event.type === 'post_shared') {
                     actorDelta = rewards.share_given ?? DEFAULT_ACTION_REWARDS.share_given;
                     actorEventType = 'share_given';
                }

                if (actorDelta > 0 && actorEventType) {
                    accumulateDelta(updatesByProfile, event.source, cid, actorDelta);
                    
                    logsToInsert.push({
                        target_profile_id: event.source, // The actor is the target of the reward
                        source_profile_id: event.source, 
                        event_type: actorEventType,
                        entity_id: event.entity,
                        delta: actorDelta,
                        trust_level_snapshot: event.lvl,
                        created_at: new Date(event.ts)
                    });
                }
            }

            if (event.eventId) processedEventIds.push(event.eventId);
        }

        // 4. Bulk Write Logs (Non-Transactional)
        if (logsToInsert.length > 0) {
            await ReputationLog.insertMany(logsToInsert, { ordered: false });
        }

        // 5. Bulk Update Profiles (Non-Transactional)
        const profilesToUpdate = Object.keys(updatesByProfile);
        if (profilesToUpdate.length > 0) {
            const currentProfiles = await Profile.find({ _id: { $in: profilesToUpdate } })
                                                 .select('_id author trust cid');

            const bulkOps = currentProfiles.map(p => {
                const updateData = updatesByProfile[p._id.toString()];
                if (!updateData) return null;

                const config = configMap[p.cid];
                const currentScore = p.trust?.score || 0;
                
                const rawNewScore = currentScore + updateData.delta;
                const newScore = Math.round(rawNewScore * 10000) / 10000; 
                const newLevel = getTrustLevel(newScore, config.levels);

                return {
                    updateOne: {
                        filter: { _id: p._id },
                        update: {
                            $set: { 
                                'trust.score': newScore,
                                'trust.level': newLevel,
                                'trust.last_calc': new Date()
                            }
                        }
                    }
                };
            }).filter(Boolean);

            if (bulkOps.length > 0) {
                await Profile.bulkWrite(bulkOps, { ordered: false });
            }
        }

        // 6. Finalize & Cleanup
        await Promise.all(processedEventIds.map(id => markEventProcessed(id)));
        await cacheClient.ltrim(REPUTATION_QUEUE_KEY, rawEvents.length, -1);

        return {
            eventsProcessed: events.length,
            profilesUpdated: profilesToUpdate.length,
        };

    } catch (error) {
        console.error('❌ Reputation Processor Error:', error);
        throw error;
    }
};