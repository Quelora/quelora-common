/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/suggestService.js */

const { mongoose } = require('../db');
const Profile = require('../models/Profile');
const ProfileSuggestion = require('../models/ProfileSuggestion');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileBlock = require('../models/ProfileBlock');
const ProfileNotInterested = require('../models/ProfileNotInterested');
const ProfileLike = require('../models/ProfileLike');
const Client = require('../models/Client');
const geoUtils = require('../utils/geoUtils');
const { cacheService, cacheClient } = require('./cacheService');

// --- Configuration Settings ---
const BATCH_SIZE = 500;
const SUGGESTION_LIMIT = 20;
const DAYS_ACTIVE = 7;
const INTEREST_WINDOW_DAYS = 35;
const LOCK_KEY_PREFIX = 'job:arc_suggestions:';
const WEIGHTS = {
    SOCIAL_CONNECTION: 5,
    INTEREST_MATCH: 4,
    GEO_EXACT: 10,
    GEO_NEAR: 5,
    VERIFIED: 5,
    POPULARITY_MULTIPLIER: 3
};

const buildEffectiveConfig = (params = {}) => ({
    suggestionLimit:    params.suggestionLimit    ?? SUGGESTION_LIMIT,
    daysActive:         params.daysActive         ?? DAYS_ACTIVE,
    interestWindowDays: params.interestWindowDays ?? INTEREST_WINDOW_DAYS,
    weights: {
        SOCIAL_CONNECTION:    (params.weights?.socialConnection)    ?? WEIGHTS.SOCIAL_CONNECTION,
        INTEREST_MATCH:       (params.weights?.interestMatch)       ?? WEIGHTS.INTEREST_MATCH,
        GEO_EXACT:            (params.weights?.geoExact)            ?? WEIGHTS.GEO_EXACT,
        GEO_NEAR:             (params.weights?.geoNear)             ?? WEIGHTS.GEO_NEAR,
        VERIFIED:             (params.weights?.verified)            ?? WEIGHTS.VERIFIED,
        POPULARITY_MULTIPLIER:(params.weights?.popularityMultiplier)?? WEIGHTS.POPULARITY_MULTIPLIER,
    },
});

const getCommunityPopularPool = async (cid) => {
    return await Profile.find({ 
        cid: cid,
        $and: [
            { $or: [{ isBanned: false }, { isBanned: { $exists: false } }] },
            { $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] }
        ]
    })
    .sort({ followersCount: -1, created_at: -1 }) 
    .limit(1000)
    .select('_id followersCount isVerified geohash')
    .lean();
};

/**
 * Fetches context data (Social, Geo, Interests) for a batch.
 */
const fetchBatchContext = async (users, cid, config) => {
    const userIds = users.map(u => u._id);

    const [allFollowing, allBlocked, allBlockers, allNotInterested] = await Promise.all([
        ProfileFollowing.find({ profile_id: { $in: userIds } }).select('profile_id following_id').lean(),
        ProfileBlock.find({ blocker_id: { $in: userIds } }).select('blocker_id blocked_id').lean(),
        ProfileBlock.find({ blocked_id: { $in: userIds } }).select('blocker_id blocked_id').lean(),
        ProfileNotInterested.find({ profile_id: { $in: userIds } }).select('profile_id target_id').lean()
    ]);

    const exclusionMap = new Map();
    const myFollowingMap = new Map(); 

    users.forEach(u => {
        const uid = u._id.toString();
        exclusionMap.set(uid, new Set([uid]));
        myFollowingMap.set(uid, []);
    });

    const addExclusion = (sid, tid) => exclusionMap.get(sid.toString())?.add(tid.toString());

    allFollowing.forEach(x => {
        addExclusion(x.profile_id, x.following_id);
        myFollowingMap.get(x.profile_id.toString())?.push(x.following_id);
    });
    allBlocked.forEach(x => addExclusion(x.blocker_id, x.blocked_id));
    allBlockers.forEach(x => addExclusion(x.blocked_id, x.blocker_id));
    allNotInterested.forEach(x => addExclusion(x.profile_id, x.target_id));

    const neededHashes = new Set();
    users.forEach(u => {
        if (u.geohash) geoUtils.getGeohashCluster(u.geohash).forEach(h => neededHashes.add(h));
    });

    let geoCandidatesMap = new Map();
    if (neededHashes.size > 0) {
        const geoProfiles = await Profile.find({
            cid: cid,
            geohash: { $in: Array.from(neededHashes) },
            $and: [
                { $or: [{ isBanned: false }, { isBanned: { $exists: false } }] },
                { $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] }
            ]
        })
        .select('_id geohash followersCount isVerified')
        .limit(5000)
        .lean();

        geoProfiles.forEach(p => {
            if (!geoCandidatesMap.has(p.geohash)) geoCandidatesMap.set(p.geohash, []);
            geoCandidatesMap.get(p.geohash).push(p);
        });
    }

    const uniqueFriendIds = new Set();
    allFollowing.forEach(f => uniqueFriendIds.add(f.following_id));
    
    const fofRelations = await ProfileFollowing.find({
        profile_id: { $in: Array.from(uniqueFriendIds) } 
    })
    .select('profile_id following_id') 
    .limit(15000) 
    .lean();

    const potentialCandidateIds = new Set();
    const interestDateLimit = new Date();
    interestDateLimit.setDate(interestDateLimit.getDate() - config.interestWindowDays);

    const myBatchLikes = await ProfileLike.find({
        profile_id: { $in: userIds },
        created_at: { $gte: interestDateLimit }
    }).select('profile_id fk_id').lean();

    const userLikesMap = new Map(); 
    const relevantPostIds = new Set();

    myBatchLikes.forEach(like => {
        const uid = like.profile_id.toString();
        if (!userLikesMap.has(uid)) userLikesMap.set(uid, new Set());
        userLikesMap.get(uid).add(like.fk_id.toString());
        relevantPostIds.add(like.fk_id.toString());
    });

    let otherLikers = [];
    if (relevantPostIds.size > 0) {
        otherLikers = await ProfileLike.find({
            fk_id: { $in: Array.from(relevantPostIds) },
            profile_id: { $nin: userIds },
            created_at: { $gte: interestDateLimit }
        })
        .select('profile_id fk_id')
        .limit(10000)
        .lean();
    }

    fofRelations.forEach(r => potentialCandidateIds.add(r.following_id.toString()));
    otherLikers.forEach(l => potentialCandidateIds.add(l.profile_id.toString()));

    let validCandidateSet = new Set();
    if (potentialCandidateIds.size > 0) {
        const validCandidates = await Profile.find({
            _id: { $in: Array.from(potentialCandidateIds) },
            cid: cid,
            isBanned: false,
            isDeleted: false
        }).select('_id').lean();
        
        validCandidateSet = new Set(validCandidates.map(c => c._id.toString()));
    }

    const friendsFollowMap = new Map(); 
    fofRelations.forEach(rel => {
        const candId = rel.following_id.toString();
        if (validCandidateSet.has(candId)) {
            const fid = rel.profile_id.toString();
            if (!friendsFollowMap.has(fid)) friendsFollowMap.set(fid, []);
            friendsFollowMap.get(fid).push(candId);
        }
    });

    const affinityLikersMap = new Map();
    otherLikers.forEach(like => {
        const candId = like.profile_id.toString();
        if (validCandidateSet.has(candId)) {
            const pid = like.fk_id.toString();
            if (!affinityLikersMap.has(pid)) affinityLikersMap.set(pid, []);
            affinityLikersMap.get(pid).push(candId);
        }
    });

    return { 
        exclusionMap, geoCandidatesMap, 
        myFollowingMap, friendsFollowMap, 
        userLikesMap, affinityLikersMap 
    };
};

const processBatch = async (users, communityPool, cid, config) => {
    const {
        exclusionMap, geoCandidatesMap,
        myFollowingMap, friendsFollowMap,
        userLikesMap, affinityLikersMap
    } = await fetchBatchContext(users, cid, config);

    const bulkOps = [];

    users.forEach(user => {
        const userIdStr = user._id.toString();
        const exclusions = exclusionMap.get(userIdStr);
        const combinedMap = new Map(); 

        const upsertCandidate = (id, data) => {
            const strId = id.toString();
            if (exclusions.has(strId)) return;

            let entry = combinedMap.get(strId);
            if (!entry) {
                entry = {
                    target_id: id,
                    sources: new Set([data.source]),
                    commonConnections: data.commonConnections || 0,
                    sharedInterests: data.sharedInterests || 0,
                    isExactGeo: data.isExactGeo || false,
                    isVerified: data.isVerified || false,
                    followersCount: data.followersCount || 0,
                    mutualFriendIds: [] 
                };
                combinedMap.set(strId, entry);
            } else {
                if (data.commonConnections) entry.commonConnections += data.commonConnections;
                if (data.sharedInterests) entry.sharedInterests += data.sharedInterests;
                if (data.isExactGeo) entry.isExactGeo = true;
                if (data.source) entry.sources.add(data.source);
            }

            if (data.friendId && entry.mutualFriendIds.length < 5) {
                if (!entry.mutualFriendIds.includes(data.friendId)) {
                    entry.mutualFriendIds.push(data.friendId);
                }
            }
        };

        const myFriends = myFollowingMap.get(userIdStr) || [];
        const sampleFriends = myFriends.slice(0, 50); 
        sampleFriends.forEach(friendId => {
            const fidStr = friendId.toString();
            const candidates = friendsFollowMap.get(fidStr) || [];
            candidates.forEach(candId => upsertCandidate(candId, { 
                source: 'social', 
                commonConnections: 1,
                friendId: fidStr 
            }));
        });

        const myLikedPosts = userLikesMap.get(userIdStr);
        if (myLikedPosts) {
            myLikedPosts.forEach(postId => {
                const likers = affinityLikersMap.get(postId) || [];
                likers.forEach(candId => upsertCandidate(candId, { source: 'interest', sharedInterests: 1 }));
            });
        }

        if (user.geohash) {
            const cluster = geoUtils.getGeohashCluster(user.geohash);
            cluster.forEach(hash => {
                const profiles = geoCandidatesMap.get(hash) || [];
                profiles.forEach(p => upsertCandidate(p._id, { 
                    source: 'geo', 
                    isExactGeo: hash === user.geohash,
                    isVerified: p.isVerified,
                    followersCount: p.followersCount
                }));
            });
        }

        if (combinedMap.size < 50) {
            const startIdx = Math.floor(Math.random() * (communityPool.length - 50));
            const safeStart = Math.max(0, startIdx);
            const randomPool = communityPool.slice(safeStart, safeStart + 50);

            for (const cand of randomPool) {
                if (combinedMap.size >= 100) break;
                upsertCandidate(cand._id, { 
                    source: 'global',
                    isVerified: cand.isVerified,
                    followersCount: cand.followersCount
                });
            }
        }

        const scoredCandidates = Array.from(combinedMap.values()).map(cand => {
            let score = 0;
            let reason = 'popular'; 

            const W = config.weights;
            if (cand.commonConnections > 0) {
                score += Math.min(cand.commonConnections * W.SOCIAL_CONNECTION, 50);
                reason = 'social';
            }
            if (cand.sharedInterests > 0) {
                score += Math.min(cand.sharedInterests * W.INTEREST_MATCH, 40);
                if (cand.sharedInterests * W.INTEREST_MATCH > (cand.commonConnections * W.SOCIAL_CONNECTION)) {
                    reason = 'interest';
                }
            }
            if (cand.sources.has('geo')) {
                const geoPoints = cand.isExactGeo ? W.GEO_EXACT : W.GEO_NEAR;
                score += geoPoints;
                if (score === geoPoints) reason = 'location';
            }
            if (cand.isVerified) score += W.VERIFIED;
            if (cand.followersCount > 0) {
                score += Math.log10(cand.followersCount + 1) * W.POPULARITY_MULTIPLIER;
            }

            return {
                target_id: cand.target_id,
                score,
                reason,
                common_connections: cand.commonConnections,
                mutual_friend_ids: cand.mutualFriendIds
            };
        });

        const finalSuggestions = scoredCandidates
            .sort((a, b) => b.score - a.score)
            .slice(0, config.suggestionLimit);

        if (finalSuggestions.length > 0) {
            bulkOps.push({
                updateOne: {
                    filter: { profile_id: user._id },
                    update: { 
                        $set: { 
                            suggestions: finalSuggestions, 
                            updated_at: new Date() 
                        } 
                    },
                    upsert: true
                }
            });
        }
    });

    if (bulkOps.length > 0) {
        await ProfileSuggestion.bulkWrite(bulkOps, { ordered: false });
    }
};

/**
 * Executes the suggestion logic for a specific Community (CID).
 * Uses a granular lock to prevent overlapping runs for the same community.
 * Exposed for Worker consumption.
 */
const processCommunity = async (cid, specificUserId = null, params = {}) => {
    // 1. GRANULAR LOCKING
    const lockKey = `${LOCK_KEY_PREFIX}${cid}`;
    const doLock = !specificUserId;

    if (doLock) {
        // Reduced TTL to 10 mins as jobs run often
        const acquired = await cacheClient.set(lockKey, 'running', 'EX', 600, 'NX');
        if (!acquired) {
            console.warn(`⚠️ [ARC] CID ${cid}: Skipped. Job already running.`);
            return { usersProcessed: 0, skipped: true };
        }
    }

    const config = buildEffectiveConfig(params);
    let processedCount = 0;

    try {
        const communityPool = await getCommunityPopularPool(cid);
        if (communityPool.length === 0 && !specificUserId) {
            return { usersProcessed: 0 };
        }

        let query = {
            cid: cid,
            $and: [
                { $or: [{ isBanned: false }, { isBanned: { $exists: false } }] },
                { $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] }
            ]
        };

        if (specificUserId) {
            query._id = new mongoose.Types.ObjectId(specificUserId);
        } else {
            const lastActiveLimit = new Date();
            lastActiveLimit.setDate(lastActiveLimit.getDate() - config.daysActive);
            query.lastActivityDate = { $gte: lastActiveLimit };
        }

        const cursor = Profile.find(query)
            .select('_id geohash location followersCount isVerified cid')
            .lean()
            .cursor({ batchSize: BATCH_SIZE });

        let batchUsers = [];

        for (let user = await cursor.next(); user != null; user = await cursor.next()) {
            batchUsers.push(user);
            if (batchUsers.length >= BATCH_SIZE) {
                await processBatch(batchUsers, communityPool, cid, config);
                processedCount += batchUsers.length;
                batchUsers = [];
                if (global.gc) global.gc();
            }
        }

        if (batchUsers.length > 0) {
            await processBatch(batchUsers, communityPool, cid, config);
            processedCount += batchUsers.length;
        }

        console.log(`⚡ [ARC] CID ${cid}: Suggestion Update Finished. (${processedCount} processed)`);

    } catch (error) {
        console.error(`❌ [ARC] Error processing CID ${cid}:`, error.message);
        throw error;
    } finally {
        if (doLock) {
            await cacheService.delete(lockKey);
        }
    }

    return { usersProcessed: processedCount };
};

module.exports = { processCommunity };