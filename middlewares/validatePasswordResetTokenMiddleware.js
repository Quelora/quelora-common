/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: ./middlewares/validatePasswordResetTokenMiddleware.js */

const { validateToken } = require('@quelora/common/services/authService'); 

/**
 * Validates a password reset token passed via Authorization header.
 *
 * The token must:
 * - Be a valid Bearer token
 * - Be validated against the tenant's dynamically resolved JWT secret
 * - Match the expected password reset scope
 *
 * On success, the author identifier is attached to the request.
 *
 * @async
 * @function validatePasswordResetToken
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
async function validatePasswordResetToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '{{resetTokenMissing}}' });
    }

    const resetToken = authHeader.split(' ')[1];
    const clientIp = req.ip;
    
    const cid = req.cid || req.headers['x-client-id'] || req.headers['X-Client-ID'];

    if (!cid) {
        return res.status(400).json({ message: 'Client context missing. Cannot validate reset token.' });
    }

    try {
        const payload = await validateToken(resetToken, clientIp, cid, false);
        
        if (payload.scope && payload.scope !== 'password_reset_scope') {
             return res.status(403).json({ message: '{{invalidTokenForReset}}' });
        }

        req.author = payload.author;
        
        next();
    } catch (error) {
        return res.status(401).json({ message: '{{invalidOrExpiredResetToken}}' });
    }
}

module.exports = validatePasswordResetToken;