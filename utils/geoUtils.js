/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const ngeohash = require('ngeohash');

/**
* Gets the geohash and its 8 neighbors to expand the search radius
* @param {string} geohash - User's geohash
* @returns {string[]} Array with 9 geohashes (central + neighbors)
*/
const getGeohashCluster = (geohash) => {
    if (!geohash || geohash.length < 4) return [];
    // We reduce precision to 4 or 5 characters to group neighborhoods/cities
    // 5 characters ~= 4.9km x 4.9km
    // 4 characters ~= 39km x 19km
    const baseHash = geohash.substring(0, 5); 
    const neighbors = ngeohash.neighbors(baseHash);
    return [baseHash, ...neighbors];
};

module.exports = { getGeohashCluster };