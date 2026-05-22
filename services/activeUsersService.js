/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/activeUsersService.js */

/**
 * @file activeUsersService.js
 * @version 3.1.0 (Pure Tenant Isolation)
 * @description Service for tracking user presence and calculating activity scores.
 * STRICT ISOLATION MODE: Removed all Global ZSET references. 
 * All presence data is strictly scoped to `cid:{cid}:...`.
 */

const { cacheClient } = require('./cacheService');
const Profile = require('../models/Profile');

const ONLINE_WINDOW_SECONDS = 300; 

/**
 * Helper to generate the Tenant-Specific Online Key (ZSET).
 * @param {string} cid
 * @returns {string}
 */
const getCidOnlineKey = (cid) => `cid:${cid}:users:online`;

/**
 * Helper to generate the Tenant-Specific Metadata Key (HASH).
 * @param {string} cid
 * @param {string} userId
 * @returns {string}
 */
const getCidMetaKey = (cid, userId) => `cid:${cid}:meta:user:${userId}`;

/**
 * Atomically increments the user's activity score within a specific Tenant scope.
 * @param {string} userId
 * @param {string} cid - Required.
 * @param {number} [amount=1]
 */
const incrementActivityScore = async (userId, cid, amount = 1) => {
    if (!userId || !cid) return;
    
    const metaKey = getCidMetaKey(cid, userId);
    
    cacheClient.hincrby(metaKey, 'activity_score', amount).catch(err => {
        console.error('[ActiveUsers] Error incrementing score:', err.message);
    });
    
    cacheClient.expire(metaKey, ONLINE_WINDOW_SECONDS + 60).catch(() => {});
};

/**
 * Tracks user presence strictly in the Tenant-specific set.
 * @param {string} userId
 * @param {string} cid
 * @param {Object} meta
 */
const trackUserActivity = async (userId, cid, meta = {}) => {
    if (!userId || !cid) return;

    const now = Date.now();
    const cidOnlineKey = getCidOnlineKey(cid);
    const cidMetaKey = getCidMetaKey(cid, userId);
    
    const pipeline = cacheClient.pipeline();

    // 1. Write to Tenant-Specific Set (Primary for P2P & Presence)
    pipeline.zadd(cidOnlineKey, now, userId);
    
    // REMOVED: Global ZSET write. Isolation is now absolute.

    // 2. Update Rich Metadata (Hash) - ISOLATED PER CID
    const metaPayload = {
        ip: meta.ip || '',
        cid: cid,
        last_seen: now,
        country: meta.geoData?.countryCode || '',
        city: meta.geoData?.city || '',
        trust_level: meta.trustLevel !== undefined ? meta.trustLevel : 0
    };

    pipeline.hmset(cidMetaKey, metaPayload);
    
    // 3. Set TTLs
    pipeline.expire(cidMetaKey, ONLINE_WINDOW_SECONDS + 60);

    try {
        await pipeline.exec();
    } catch (error) {
        console.error(`[ActiveUsers] Error tracking for ${userId} in ${cid}:`, error.message);
    }
};

/**
 * Retrieves online status within a specific CID.
 * @param {string} memberId
 * @param {string} cid - Required.
 */
const getUserOnlineStatus = async (memberId, cid) => {
    if (!memberId || !cid) return { online: false, lastSeen: null };

    const targetKey = getCidOnlineKey(cid);
    const score = await cacheClient.zscore(targetKey, memberId);

    if (!score) {
        return { online: false, lastSeen: null };
    }

    const lastSeenTimestamp = parseInt(score, 10);
    const now = Date.now();
    const isOnline = (now - lastSeenTimestamp) <= (ONLINE_WINDOW_SECONDS * 1000);

    return {
        userId: memberId,
        online: isOnline,
        lastSeen: new Date(lastSeenTimestamp).toISOString(),
        secondsAgo: Math.floor((now - lastSeenTimestamp) / 1000)
    };
};

/**
 * Returns traffic stats for a specific tenant.
 * @param {string} cid - Required.
 */
const getTrafficStats = async (cid) => {
    if (!cid) return { total: 0, breakdown: { registered: 0, guests: 0 } };

    const now = Date.now();
    const minScore = now - (ONLINE_WINDOW_SECONDS * 1000);
    const targetKey = getCidOnlineKey(cid);
    // Note: Guest tracking (Redis Key Guests) needs similar refactor if guests are critical per-tenant.
    // For now, we return registered users count for the specific CID.
    
    const registeredCount = await cacheClient.zcount(targetKey, minScore, '+inf');

    return {
        total: registeredCount,
        breakdown: {
            registered: registeredCount,
            guests: 0 // Guest isolation requires deeper changes in authMiddleware/guest logic
        },
        windowSeconds: ONLINE_WINDOW_SECONDS
    };
};

/**
 * Get count of online registered users for a tenant.
 * @param {string} cid - Required.
 */
const getOnlineRegisteredCount = async (cid) => {
    if (!cid) return 0;
    const now = Date.now();
    const minScore = now - (ONLINE_WINDOW_SECONDS * 1000);
    const targetKey = getCidOnlineKey(cid);
    return cacheClient.zcount(targetKey, minScore, '+inf');
};

/**
 * Retrieves a paginated list of active users for a tenant.
 * @param {string} cid - Required.
 * @param {number} [page=1]
 * @param {number} [limit=20]
 */
const getActiveUsersList = async (cid, page = 1, limit = 20) => {
    if (!cid) return { data: [], pagination: { page, limit, total: 0 } };

    const now = Date.now();
    const minScore = now - (ONLINE_WINDOW_SECONDS * 1000);
    const offset = (page - 1) * limit;
    
    const targetKey = getCidOnlineKey(cid);

    const activeAuthorIds = await cacheClient.zrevrangebyscore(
        targetKey,
        '+inf',
        minScore,
        'LIMIT',
        offset,
        limit
    );

    if (!activeAuthorIds || activeAuthorIds.length === 0) {
        return {
            data: [],
            pagination: { page, limit, total: 0 }
        };
    }

    const profiles = await Profile.find({
        author: { $in: activeAuthorIds },
        cid: cid
    })
    .select('author name username picture avatar')
    .lean();

    const profileMap = new Map(profiles.map(p => [p.author, p]));
    const orderedProfiles = activeAuthorIds
        .map(id => profileMap.get(id))
        .filter(Boolean); 

    const totalCount = await getOnlineRegisteredCount(cid);

    return {
        data: orderedProfiles,
        pagination: {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
        }
    };
};

/**
 * Batched status retrieval within a Tenant.
 * @param {Array<string>} memberIds
 * @param {string} cid - Required.
 */
const getUsersOnlineStatusBatch = async (memberIds, cid) => {
    if (!memberIds || memberIds.length === 0 || !cid) return {};

    const uniqueIds = [...new Set(memberIds.filter(Boolean).map(id => id.toString()))];
    if (uniqueIds.length === 0) return {};

    const targetKey = getCidOnlineKey(cid);
    const pipeline = cacheClient.pipeline();
    
    uniqueIds.forEach(id => {
        pipeline.zscore(targetKey, id);
    });

    const results = await pipeline.exec();
    const now = Date.now();
    const statusMap = {};

    uniqueIds.forEach((id, index) => {
        const [err, score] = results[index];
        if (err || !score) {
            statusMap[id] = { online: false, lastSeen: null };
        } else {
            const lastSeenTimestamp = parseInt(score, 10);
            const isOnline = (now - lastSeenTimestamp) <= (ONLINE_WINDOW_SECONDS * 1000);
            statusMap[id] = {
                online: isOnline,
                lastSeen: new Date(lastSeenTimestamp)
            };
        }
    });

    return statusMap;
};

module.exports = {
    incrementActivityScore,
    trackUserActivity,
    getUserOnlineStatus,
    getTrafficStats,
    getOnlineRegisteredCount,
    getActiveUsersList,
    getUsersOnlineStatusBatch
};