/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { cacheClient } = require('../services/cacheService');

const recordGeoActivity = async (req, action, entityId = null, timestamp = null) => {
    if (!req.cid || !req.clientCountry) return;

    const keyIdentifier = entityId ? `entity:${entityId}` : 'general';
    const escapedIp = (req.clientIp || 'unknown').replace(/:/g, ';');
    // Format: [cid]:[keyIdentifier]:[ip]:[country]:[countryCode]:[region]:[regionCode]:[city]:[lat]:[lon]
    const geoKey = [
        req.cid,
        keyIdentifier,
        escapedIp || 'unknown',
        req.clientCountry,
        req.clientCountryCode || 'unknown',
        req.clientRegion || 'unknown',
        req.clientRegionCode || 'unknown',
        req.clientCity || 'unknown',
        req.clientLatitude || '',
        req.clientLongitude || ''
    ].join(':');

    if (timestamp) {
        const date = new Date(timestamp);
        const pad = (num) => num.toString().padStart(2, '0');
        const yyyymmddhhmm = date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes());
        // Key: geo:activity:timestamp:[action]:[YYYYMMDDHHmm]
        await cacheClient.hIncrBy(
            `geo:activity:timestamp:${action}:${yyyymmddhhmm}`,
            geoKey,
            1
        );
    } else {
        await cacheClient.hIncrBy(
            `geo:activity:${action}`,
            geoKey,
            1
        );
    }
};

const recordActivityHit = async (key, action = 'added', entityId = null, timestamp = null) => {
    const cid = key.split(':')[2];
    const type = key.split(':')[1];
    
    // key: activity:[type]:[cid]
    const baseKey = `activity:${type}:${cid}`;
    
    if (timestamp) {
        const date = new Date(timestamp);
        const pad = (num) => num.toString().padStart(2, '0');
        const yyyymmddhhmm = date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes());
        
        // Key: activity:timestamp:[type]:[cid]:[YYYYMMDDHHmm] 
        // Key: activity:timestamp:[type]:[cid]:[entityId]:[YYYYMMDDHHmm]
        const fullKey = entityId 
            ? `activity:timestamp:${type}:${cid}:${entityId}:${yyyymmddhhmm}` 
            : `activity:timestamp:${type}:${cid}:${yyyymmddhhmm}`;
            
        await cacheClient.hIncrBy(fullKey, action, 1);
    } else {
        const fullKey = entityId ? `${baseKey}:${entityId}` : baseKey;
        await cacheClient.hIncrBy(fullKey, action, 1);
    }
};

module.exports = { recordGeoActivity, recordActivityHit };