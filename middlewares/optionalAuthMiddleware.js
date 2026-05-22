/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middlewares/optionalAuthMiddleware.js */

const { validateToken } = require('@quelora/common/services/authService');

/**
 * Optional authentication middleware.
 *
 * Attempts to authenticate the request using a Bearer token.
 * Dynamically resolves the JWT secret using the client identifier (CID) for tenant users.
 * If authentication fails, no token is provided, or the client context is missing, 
 * the request continues without a user context.
 *
 * When valid, the decoded token payload is attached to `req.user`.
 *
 * @async
 * @function optionalAuthMiddleware
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
async function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    const token = authHeader.slice(7);
    const clientIp = req.ip;
    
    const cid = req.cid || req.headers['x-client-id'] || req.headers['X-Client-ID'];

    // If there is no tenant context, we cannot validate the tenant token.
    // Since authentication is optional, we just move forward as a guest.
    if (!cid) {
        return next();
    }

    try {
        req.user = await validateToken(token, clientIp, cid, false);
    } catch (_) {
        // Authentication is optional; silently ignore invalid tokens, 
        // network origin mismatches, or missing client configurations.
    }

    return next();
}

module.exports = optionalAuthMiddleware;