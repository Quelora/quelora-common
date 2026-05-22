/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middlewares/responseCompressor.js */
const { cacheService } = require('../services/cacheService');

const DEFAULT_TTL_SECONDS = 10;
const GUEST_TTL_SECONDS = 60;

const CACHE_EXCLUSION_LIST = ['/client/', '/auth/', '/sso/'];

/**
 * Determines whether a value is a plain JSON-compatible structure:
 * - Accepts: {} objects, arrays, objects created via Object.create(null)
 * - Rejects: null, Date, RegExp, ObjectId, Buffer, custom classes, etc.
 *
 * @param {*} data
 * @returns {boolean}
 */
function isPlainObject(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data)) return true;

    const proto = Object.getPrototypeOf(data);
    if (!proto) return true;

    return proto.constructor === Object;
}

/**
 * Recursively scans plain JSON structures and builds a dictionary mapping
 * originalKey -> shortKeyIndex.
 * The traversal stops when encountering non-plain objects (Date, ObjectId, etc.).
 *
 * @param {*} data
 * @param {object} keyMap
 * @param {number} nextIndex
 * @returns {number}
 */
function mapKeysRecursively(data, keyMap, nextIndex) {
    if (!isPlainObject(data)) return nextIndex;

    if (Array.isArray(data)) {
        for (const item of data) nextIndex = mapKeysRecursively(item, keyMap, nextIndex);
    } else {
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                if (keyMap[key] === undefined) keyMap[key] = nextIndex++;
                nextIndex = mapKeysRecursively(data[key], keyMap, nextIndex);
            }
        }
    }

    return nextIndex;
}

/**
 * Returns a new structure where keys have been replaced using the mapping
 * shortKeyIndex -> originalKey.
 * Non-plain objects (Date, ObjectId, etc.) are returned untouched.
 *
 * @param {*} data
 * @param {object} keyMap
 * @returns {*}
 */
function replaceKeys(data, keyMap) {
    if (!isPlainObject(data)) return data;

    if (Array.isArray(data)) {
        return data.map(item => replaceKeys(item, keyMap));
    }

    const compressed = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const shortKey = keyMap[key];
            const finalKey = shortKey !== undefined ? String(shortKey) : key;
            compressed[finalKey] = replaceKeys(data[key], keyMap);
        }
    }
    return compressed;
}

async function getCachedPayload(key) {
    try {
        return await cacheService.get(key);
    } catch {
        return null;
    }
}

async function setCachePayload(key, finalPayload, ttlSeconds) {
    try {
        await cacheService.set(key, finalPayload, ttlSeconds);
    } catch {}
}

/**
 * Middleware that:
 * - Compresses JSON responses by replacing keys with numeric identifiers
 * - Sends a dictionary for client-side reconstruction
 * - Caches compressed responses for anonymous GET requests
 */
const responseCompressor = async (req, res, next) => {
    if (process.env.DISABLE_RESPONSE_COMPRESSOR === '1') return next();

    const originalJson = res.json;

    const userId = req.user && (req.user.author || req.user._id)
        ? (req.user.author || String(req.user._id))
        : 'GUEST';
    const isAnonymous = userId === 'GUEST';

    const requestUrl = req.originalUrl || req.url;
    const isExcluded = CACHE_EXCLUSION_LIST.some(prefix => requestUrl.startsWith(prefix));
    const isCacheable = req.method === 'GET' && isAnonymous && !isExcluded;

    const cacheKey = `comp:${requestUrl}`;

    if (isCacheable) {
        const cachedPayload = await getCachedPayload(cacheKey);
        if (cachedPayload) {
            res.setHeader('X-Cache-Compressor', 'HIT');
            return originalJson.call(res, cachedPayload);
        }
    }

    res.json = async function (body) {
        try {
            // Normalize Mongoose documents before processing
            let cleanBody = body;
            if (body && typeof body.toJSON === 'function') {
                cleanBody = body.toJSON();
            }

            // Skip compression for non-plain, error status, or explicit error responses
            if (!isPlainObject(cleanBody) || res.statusCode >= 400 || (cleanBody.success === false && 'success' in cleanBody)) {
                if (req.method === 'GET') res.setHeader('X-Cache-Compressor', 'BYPASS_TYPE');
                return originalJson.call(res, body);
            }

            const dynamicDictionary = {};
            mapKeysRecursively(cleanBody, dynamicDictionary, 0);

            const compressedData = replaceKeys(cleanBody, dynamicDictionary);

            const invertedDictionary = {};
            for (const key in dynamicDictionary) {
                invertedDictionary[dynamicDictionary[key]] = key;
            }

            const finalPayload = {
                data: compressedData,
                dictionary: invertedDictionary
            };

            if (isCacheable) {
                await setCachePayload(cacheKey, finalPayload, GUEST_TTL_SECONDS);
                res.setHeader('X-Cache-Compressor', 'MISS');
            } else {
                res.setHeader('X-Cache-Compressor', isAnonymous ? 'BYPASS_METHOD' : 'NOCACHE_USER');
            }

            return originalJson.call(res, finalPayload);

        } catch (error) {
            console.error('Compression Panic:', error);
            res.setHeader('X-Cache-Compressor', 'ERROR');
            return originalJson.call(res, body);
        }
    };

    next();
};

module.exports = responseCompressor;