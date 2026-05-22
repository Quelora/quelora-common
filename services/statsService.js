/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/statsService.js */
const { cacheClient } = require('./cacheService');
const { mongoose } = require('../db');

// Rutas actualizadas a common/models
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');
const GeoPostStats = require('../models/GeoPostStats');
const PostStats = require('../models/PostStats');
const Post = require('../models/Post');
const ProfileStats = require('../models/ProfileStats');

const parseGeoKey = (geoKey) => {
    const parts = geoKey.split(':');
    if (parts.length === 10 && parts[1] === 'general') {
        return {
            cid: parts[0],
            keyIdentifier: parts[1],
            ip: parts[2],
            country: parts[3],
            countryCode: parts[4],
            region: parts[5],
            regionCode: parts[6],
            city: parts[7],
            lat: parts[8],
            lon: parts[9],
            isPostKey: false
        };
    } 
    if (parts.length === 11 && parts[1] === 'entity') {
        const keyIdentifier = `${parts[1]}:${parts[2]}`;
        return {
            cid: parts[0],
            keyIdentifier: keyIdentifier,
            ip: parts[3],
            country: parts[4],
            countryCode: parts[5],
            region: parts[6],
            regionCode: parts[7],
            city: parts[8],
            lat: parts[9],
            lon: parts[10],
            isPostKey: true
        };
    }
    return null; 
};

const createDateFromYYYYMMDDHHmm = (yyyymmddhhmm) => {
    if (yyyymmddhhmm.length !== 12) return new Date();
    const year = parseInt(yyyymmddhhmm.substring(0, 4), 10);
    const month = parseInt(yyyymmddhhmm.substring(4, 6), 10) - 1;
    const day = parseInt(yyyymmddhhmm.substring(6, 8), 10);
    const hour = parseInt(yyyymmddhhmm.substring(8, 10), 10);
    const minute = parseInt(yyyymmddhhmm.substring(10, 12), 10);
    return new Date(Date.UTC(year, month, day, hour, minute));
};

const saveTimeStampedGeoStats = async (action, geoKeyPrefix) => {
    let processedCount = 0;
    const allTimestampKeys = await cacheClient.keys(`${geoKeyPrefix}:${action}:????????????`);
    for (const fullKey of allTimestampKeys) {
        const parts = fullKey.split(':');
        const yyyymmddhhmm = parts[parts.length - 1];
        const timestamp = createDateFromYYYYMMDDHHmm(yyyymmddhhmm);
        const allHits = await cacheClient.hGetAll(fullKey);
        for (const [geoKey, count] of Object.entries(allHits)) {
            const parsedData = parseGeoKey(geoKey);
            if (!parsedData) continue;
            const isPostKey = parsedData.keyIdentifier.startsWith('entity:');
            const parsedCount = parseInt(count);
            const statData = {
                cid: parsedData.cid,
                action,
                ip: parsedData.ip || 'unknown',
                country: parsedData.country || 'unknown',
                countryCode: parsedData.countryCode || 'unknown',
                region: parsedData.region || 'unknown',
                regionCode: parsedData.regionCode || 'unknown',
                city: parsedData.city || 'unknown',
                latitude: parsedData.lat ? parseFloat(parsedData.lat) : null,
                longitude: parsedData.lon ? parseFloat(parsedData.lon) : null,
                count: parsedCount,
                timestamp
            };
            if (isPostKey) {
                const entityIdString = parsedData.keyIdentifier.substring('entity:'.length);
                if (!mongoose.Types.ObjectId.isValid(entityIdString)) continue;
                await GeoPostStats.create({ ...statData, entity: new mongoose.Types.ObjectId(entityIdString) });
            } else {
                await GeoStats.create(statData);
            }
            await cacheClient.hDel(fullKey, geoKey);
            processedCount++;
        }
        const remainingKeys = await cacheClient.hGetAll(fullKey);
        if (Object.keys(remainingKeys).length === 0) {
            await cacheClient.del(fullKey);
        }
    }
    return processedCount;
};

const saveTimeStampedStats = async (keyPrefix) => {
    let processedEntities = 0;
    const allTimestampKeys = await cacheClient.keys(`${keyPrefix}:*????????????`); 
    for (const fullKey of allTimestampKeys) {
        const parts = fullKey.split(':');
        const isPostKey = parts.length === 6; 
        const type = parts[2];
        const cid = parts[3];
        const dateIndex = isPostKey ? 5 : 4;
        const yyyymmddhhmm = parts[dateIndex];
        const timestamp = createDateFromYYYYMMDDHHmm(yyyymmddhhmm);
        const allActions = await cacheClient.hGetAll(fullKey);
        const added = parseInt(allActions['added'] || 0, 10);
        const removed = parseInt(allActions['removed'] || 0, 10);
        const statsData = {
            likesAdded: type === 'likes' ? added : 0,
            likesRemoved: type === 'likes' ? removed : 0,
            sharesAdded: type === 'shares' ? added : 0,
            commentsAdded: type === 'comments' ? added : 0,
            repliesAdded: type === 'replies' ? added : 0,
        };
        if (Object.values(statsData).some(val => val > 0)) {
            if (isPostKey) {
                const entity = parts[4];
                if (!mongoose.Types.ObjectId.isValid(entity)) continue; 
                await PostStats.create({
                    cid,
                    entity: new mongoose.Types.ObjectId(entity),
                    ...statsData,
                    timestamp
                });
            } else {
                await Stats.create({
                    cid,
                    ...statsData,
                    timestamp
                });
            }
            processedEntities++;
        }
        await cacheClient.del(fullKey);
    }
    return processedEntities;
};

const saveGeoStats = async () => {
    try {
        const actions = ['like', 'share', 'comment', 'reply', 'hit'];
        let processedCount = 0;
        for (const action of actions) {
            const allKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
            for (const [geoKey, count] of Object.entries(allKeys)) {
                if (geoKey.includes(':entity:')) continue;
                const parsedData = parseGeoKey(geoKey);
                if (!parsedData || parsedData.isPostKey) continue; 
                const parsedCount = parseInt(count);
                const lat = Number(parsedData.lat);
                const lon = Number(parsedData.lon);
                await GeoStats.create({
                    cid: parsedData.cid,
                    action,
                    ip: parsedData.ip || 'unknown',
                    country: parsedData.country || 'unknown',
                    countryCode: parsedData.countryCode || 'unknown',
                    region: parsedData.region || 'unknown',
                    regionCode: parsedData.regionCode || 'unknown',
                    city: parsedData.city || 'unknown',
                    latitude: Number.isFinite(lat) ? lat : null,
                    longitude: Number.isFinite(lon) ? lon : null,
                    count: parsedCount,
                    timestamp: new Date()
                });
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        const timestampedGeoCount = 
            await saveTimeStampedGeoStats('like', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('share', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('comment', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('reply', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('hit', 'geo:activity:timestamp');
        console.log(`✅ 🌎 GeoStats Processed.`);
    } catch (error) {
        console.error('❌ Error saving system geo stats:', error);
        throw error;
    }
};

const saveGeoPostStats = async () => {
    try {
        const actions = ['like', 'share', 'comment', 'reply'];
        let processedCount = 0;
        for (const action of actions) {
            const allKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
            for (const [geoKey, count] of Object.entries(allKeys)) {
                if (!geoKey.includes(':entity:')) continue;
                const parsedData = parseGeoKey(geoKey);
                if (!parsedData || !parsedData.isPostKey) continue;
                const entityIdString = parsedData.keyIdentifier.substring('entity:'.length);
                if (!mongoose.Types.ObjectId.isValid(entityIdString)) continue;
                const parsedCount = parseInt(count);
                const lat = Number(parsedData.lat);
                const lon = Number(parsedData.lon);
                await GeoPostStats.create({
                    cid: parsedData.cid,
                    entity: new mongoose.Types.ObjectId(entityIdString),
                    action,
                    ip: parsedData.ip || 'unknown',
                    country: parsedData.country || 'unknown',
                    countryCode: parsedData.countryCode || 'unknown',
                    region: parsedData.region || 'unknown',
                    regionCode: parsedData.regionCode || 'unknown',
                    city: parsedData.city || 'unknown',
                    latitude: Number.isFinite(lat) ? lat : null,
                    longitude: Number.isFinite(lon) ? lon : null,
                    count: parsedCount,
                    timestamp: new Date()
                });
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        const timestampedGeoPostCount = 
            await saveTimeStampedGeoStats('like', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('share', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('comment', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('reply', 'geo:activity:timestamp');
        console.log(`✅ 🌎 GeoPostStats Processed.`);
    } catch (error) {
        console.error('❌ Error saving post geo stats:', error);
        throw error;
    }
};

const saveStats = async () => {
    try {
        const allActivityKeys = await cacheClient.keys('activity:*');
        const systemStats = {};
        const postStats = {};
        for (const key of allActivityKeys) {
            const parts = key.split(':');
            const type = parts[1];
            const cid = parts[2];
            if (parts[1] === 'timestamp') continue; 
            if (parts.length === 3) {
                if (!systemStats[cid]) systemStats[cid] = { types: new Set() };
                systemStats[cid].types.add(type);
            } else if (parts.length === 4) {
                const entityId = parts[3];
                if (!postStats[cid]) postStats[cid] = {};
                if (!postStats[cid][entityId]) postStats[cid][entityId] = { types: new Set() };
                postStats[cid][entityId].types.add(type);
            }
        }
        const timestamp = new Date();
        let processedPostEntities = 0;
        for (const cid of Object.keys(postStats)) {
            for (const entity of Object.keys(postStats[cid])) {
                if (!mongoose.Types.ObjectId.isValid(entity)) continue; 
                const likesAdded = await cacheClient.hGet(`activity:likes:${cid}:${entity}`, 'added') || 0;
                const likesRemoved = await cacheClient.hGet(`activity:likes:${cid}:${entity}`, 'removed') || 0;
                const sharesAdded = await cacheClient.hGet(`activity:shares:${cid}:${entity}`, 'added') || 0;
                const commentsAdded = await cacheClient.hGet(`activity:comments:${cid}:${entity}`, 'added') || 0;
                const repliesAdded = await cacheClient.hGet(`activity:replies:${cid}:${entity}`, 'added') || 0;
                const statsData = {
                    likesAdded: parseInt(likesAdded, 10),
                    likesRemoved: parseInt(likesRemoved, 10),
                    sharesAdded: parseInt(sharesAdded, 10),
                    commentsAdded: parseInt(commentsAdded, 10),
                    repliesAdded: parseInt(repliesAdded, 10)
                };
                if (Object.values(statsData).some(val => val > 0)) {
                    const stats = new PostStats({
                        cid,
                        entity: new mongoose.Types.ObjectId(entity),
                        ...statsData,
                        timestamp
                    });
                    await stats.save();
                    processedPostEntities++;
                }
                const types = postStats[cid][entity].types;
                for (const type of types) {
                    await cacheClient.del(`activity:${type}:${cid}:${entity}`);
                }
            }
        }
        const cids = Object.keys(systemStats);
        for (const cid of cids) {
            const likesAdded = await cacheClient.hGet(`activity:likes:${cid}`, 'added') || 0;
            const likesRemoved = await cacheClient.hGet(`activity:likes:${cid}`, 'removed') || 0;
            const sharesAdded = await cacheClient.hGet(`activity:shares:${cid}`, 'added') || 0;
            const commentsAdded = await cacheClient.hGet(`activity:comments:${cid}`, 'added') || 0;
            const repliesAdded = await cacheClient.hGet(`activity:replies:${cid}`, 'added') || 0;
            const statsData = {
                likesAdded: parseInt(likesAdded, 10),
                likesRemoved: parseInt(likesRemoved, 10),
                sharesAdded: parseInt(sharesAdded, 10),
                commentsAdded: parseInt(commentsAdded, 10),
                repliesAdded: parseInt(repliesAdded, 10)
            };
            if (Object.values(statsData).some(val => val > 0)) {
                const stats = new Stats({
                    cid,
                    ...statsData,
                    timestamp
                });
                await stats.save();
            }
            const types = systemStats[cid].types;
            for (const type of types) {
                await cacheClient.del(`activity:${type}:${cid}`);
            }
        }
        const timestampedCount = 
            await saveTimeStampedStats('activity:timestamp:likes') +
            await saveTimeStampedStats('activity:timestamp:shares') +
            await saveTimeStampedStats('activity:timestamp:comments') +
            await saveTimeStampedStats('activity:timestamp:replies');
        
        console.log(`✅ 📊 Stats Processed (System & Post).`);
        return { postEntities: processedPostEntities, systemCids: cids.length };
    } catch (error) {
        console.error('❌ Error saving stats:', error);
        throw error;
    }
};

const savePostViews = async () => {
    try {
        const allViewKeys = await cacheClient.keys('cid:*:postViews:*');
        const viewsByCid = {};
        for (const key of allViewKeys) {
            const parts = key.split(':');
            if (parts.length === 4 && parts[2] === 'postViews') {
                const cid = parts[1];
                const entity = parts[3];
                if (!viewsByCid[cid]) viewsByCid[cid] = {};
                viewsByCid[cid][entity] = await cacheClient.get(key);
            }
        }
        const cids = Object.keys(viewsByCid);
        let viewsProcessed = 0;
        for (const cid of cids) {
            const views = viewsByCid[cid];
            for (const entity of Object.keys(views)) {
                const viewCount = parseInt(views[entity], 10) || 0;
                if (viewCount > 0) {
                    await Post.findOneAndUpdate(
                        { entity, cid, 'deletion.status': 'active' },
                        { $inc: { viewsCount: viewCount } },
                        { new: true }
                    );
                    await cacheClient.del(`cid:${cid}:postViews:${entity}`);
                    viewsProcessed++;
                }
            }
        }
        console.log(`✅ 📊 Views Processed.`);
        return { viewsProcessed };
    } catch (error) {
        console.error('❌ Error saving post views:', error);
        throw error;
    }
};

const saveProfileStats = async () => {
    try {
        const allProfileKeys = await cacheClient.keys('activity:profile:*:*:*');
        
        let processedStatsCount = 0;

        for (const fullKey of allProfileKeys) {
            const parts = fullKey.split(':');
            const cid = parts[2];
            const profileId = parts[3];
            const yyyymmddhh = parts[4];

            const year = parseInt(yyyymmddhh.substring(0, 4), 10);
            const month = parseInt(yyyymmddhh.substring(4, 6), 10) - 1; 
            const day = parseInt(yyyymmddhh.substring(6, 8), 10);
            const hour = parseInt(yyyymmddhh.substring(8, 10), 10);
            const dateUTC = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
            
            const rawEvents = await cacheClient.lRange(fullKey, 0, -1);
            
            if (rawEvents.length === 0) {
                await cacheClient.del(fullKey);
                continue;
            }

            const events = rawEvents
                .filter(e => e && e !== "undefined")
                .map(e => {
                    try {
                        return JSON.parse(e);
                    } catch (parseError) {
                        return null;
                    }
                })
                .filter(e => e !== null)
                .reverse();
            
            if (events.length === 0) {
                await cacheClient.del(fullKey);
                continue;
            }

            const stats = {
                commentsAdded: 0,
                repliesAdded: 0,
                likesGiven: 0,
                sharesGiven: 0,
                toxicityScores: [],
                author: ''
            };

            for (const event of events) {
                stats.author = stats.author || event.author;
                switch (event.action) {
                    case 'comment-added':
                        stats.commentsAdded++;
                        const scoreComment = event.toxicityScore ?? 0;
                        stats.toxicityScores.push(scoreComment);
                        break;
                    case 'reply-added':
                        stats.repliesAdded++;
                        const scoreReply = event.toxicityScore ?? 0;
                        stats.toxicityScores.push(scoreReply);
                        break;
                    case 'like-given-added':
                        stats.likesGiven++;
                        break;
                    case 'like-given-removed':
                        stats.likesGiven--;
                        break;
                    case 'share-given-added':
                        stats.sharesGiven++;
                        break;
                }
            }

            const totalScores = stats.toxicityScores.reduce((sum, score) => sum + score, 0);
            const toxicityScoreAvg = stats.toxicityScores.length > 0 ? (totalScores / stats.toxicityScores.length) : 0;
            
            const updateData = {
                $inc: {
                    commentsAdded: stats.commentsAdded,
                    repliesAdded: stats.repliesAdded,
                    likesGiven: stats.likesGiven,
                    sharesGiven: stats.sharesGiven
                },
                $set: {
                    author: stats.author,
                    aggregationType: 'quarter-hour'
                }
            };
            
            if (stats.toxicityScores.length > 0) {
                 updateData.$set.toxicityScoreAvg = toxicityScoreAvg;
            }

            await ProfileStats.findOneAndUpdate(
                { cid, profileId: new mongoose.Types.ObjectId(profileId), date: dateUTC },
                updateData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            await cacheClient.del(fullKey);
            processedStatsCount++;
        }
        console.log(`✅ 👤 ProfileStats Processed.`);
        return { profilesProcessed: processedStatsCount };
    } catch (error) {
        console.error('❌ Error saving profile stats:', error);
        throw error;
    }
};

module.exports = { saveStats, saveGeoStats, saveGeoPostStats, savePostViews, saveProfileStats };