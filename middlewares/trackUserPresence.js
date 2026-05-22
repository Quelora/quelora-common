/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/middlewares/trackUserPresence.js */

const { cacheClient } = require('../services/cacheService');
const activeUsersService = require('../services/activeUsersService');

const PRESENCE_WINDOW_SECONDS = 300; 

/**
 * Middleware to track user presence in real-time.
 * * REFACTORED (v3.0): Strict Isolation Mode.
 * * - Registered Users: Delegated to activeUsersService (cid-scoped).
 * * - Guest Users: Now strictly scoped to `cid:{cid}:guests:online`.
 * * - Global keys removed entirely.
 * @module @quelora/common/middlewares/trackUserPresence
 */
const trackUserPresence = (req, res, next) => {
    // 1. Extract Technical IP
    const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
    
    // 2. Extract Geo Data
    const geo = req.geoData || {};

    // 3. Extract CID (Tenant) - Critical for Isolation
    // Ensure we catch it from any source
    const cid = req.cid || req.query.cid || req.headers['x-cid'] || req.headers['x-client-id'];

    // Inject normalized CID back to request for downstream controllers
    if (cid) req.cid = cid;

    // Execute logic after response is sent (Non-blocking)
    res.on('finish', () => {
        // Skip tracking for errors
        if (res.statusCode >= 400) return; 
        
        (async () => {
            try {
                // If no CID is determined, we CANNOT track presence safely in a multitenant system.
                // We abort to avoid polluting the global namespace.
                if (!cid) return;

                const now = Date.now();
                
                // --- A. Registered Users (P2P Candidates) ---
                if (req.user && req.user.author) {
                    
                    // Delegate to the Service (Writes to cid:{cid}:users:online)
                    await activeUsersService.trackUserActivity(req.user.author, cid, {
                        ip: userIp,
                        geoData: geo,
                        trustLevel: req.user.trust?.level || 0
                    });

                } 
                // --- B. Guest Users (Dashboard Stats Only) ---
                else {
                    const guestId = req.headers['x-guest-id'] || req.cookies?.guest_id;
                    
                    if (guestId) {
                        // REFACTORED: Scoped to Tenant
                        const guestKey = `cid:${cid}:guests:online`;
                        
                        await cacheClient.zadd(guestKey, now, `guest:${guestId}`);
                        // Set TTL to ensure self-cleaning
                        await cacheClient.expire(guestKey, PRESENCE_WINDOW_SECONDS);
                    }
                }

            } catch (error) {
                console.error('❌ User presence tracking error:', error.message);
            }
        })();
    });

    next();
};

module.exports = trackUserPresence;