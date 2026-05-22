/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: app/services/authService.js
/**
 * @module services/authService
 * @description JWT generation and validation for multi-tenant and admin contexts.
 *
 * Changes from previous version:
 *
 * [FIX BUG-3] `generateToken` now accepts an optional `ttlSeconds` parameter.
 *   When supplied, it takes precedence over the environment-level `JWT_TTL`
 *   default. This is required by the password-recovery flow, where the issued
 *   reset token must expire after `RECOVERY_TOKEN_TTL` seconds rather than the
 *   standard session TTL.
 *
 *   The value is converted to the `"<n>s"` string format that `jsonwebtoken`
 *   expects for numeric durations (e.g. `600` → `"600s"`).
 */

'use strict';

require('dotenv').config();

const jwt = require('jsonwebtoken');
const { getClientConfig } = require('./clientConfigService');

const {
    JWT_TTL       = '1h',
    JWT_ADMIN_SECRET,
    JWT_ADMIN_TTL = '1h',
} = process.env;

// =============================================================================
// TOKEN GENERATION
// =============================================================================

/**
 * Generates a signed JWT for a regular tenant user or an admin.
 *
 * For tenant users, the signing secret is resolved from the per-client
 * configuration via `clientConfigService` using the supplied `cid`.
 * For admins, the shared `JWT_ADMIN_SECRET` environment variable is used.
 *
 * @async
 * @param {string}      userId                  - MongoDB ObjectId string of the user document.
 * @param {string}      author                  - Stable author hash used as the public identity key.
 * @param {string}      clientIp                - IP address of the requesting client (embedded in payload for optional IP-lock).
 * @param {boolean}     [isAdmin=false]         - When `true`, signs with the admin secret and TTL.
 * @param {string|null} [cid=null]              - Tenant identifier. Required for non-admin tokens.
 * @param {number|null} [ttlSeconds=null]       - Optional TTL override in seconds. When provided,
 *   takes precedence over the `JWT_TTL` environment variable. Intended for
 *   short-lived tokens such as password-reset keys.
 * @returns {Promise<string|null>} Signed JWT string, or `null` when `cid` is
 *   missing for a tenant user (logged as a critical error).
 * @throws {Error} When `JWT_ADMIN_SECRET` is not configured for admin tokens,
 *   or when the per-tenant secret cannot be resolved.
 */
async function generateToken(userId, author, clientIp, isAdmin = false, cid = null, ttlSeconds = null) {
    const payload = {
        userId,
        author,
        ip:    clientIp,
        email: author,
        role:  isAdmin ? 'admin' : 'user',
    };

    let secret;
    let expiresIn;

    if (isAdmin) {
        if (!JWT_ADMIN_SECRET) {
            throw new Error('JWT_ADMIN_SECRET is not configured');
        }
        secret    = JWT_ADMIN_SECRET;
        expiresIn = JWT_ADMIN_TTL;
    } else {
        if (!cid) {
            console.error('🚨 [Auth] generateToken called without CID for a tenant user. userId:', userId);
            return null;
        }

        secret = await getClientConfig(cid, 'login.jwtSecret');
        if (!secret) {
            throw new Error(`JWT Secret is not configured for client: ${cid}`);
        }

        // A numeric ttlSeconds override takes precedence over the env-level default.
        // jsonwebtoken accepts numeric strings in the "<n>s" / "<n>m" / "<n>h" format.
        expiresIn = (ttlSeconds && typeof ttlSeconds === 'number' && ttlSeconds > 0)
            ? `${ttlSeconds}s`
            : JWT_TTL;
    }

    return jwt.sign(payload, secret, { expiresIn });
}

// =============================================================================
// TOKEN VALIDATION
// =============================================================================

/**
 * Validates a JWT and returns the decoded payload.
 *
 * Designed as a fail-safe: common validation errors (expired, malformed,
 * missing secret) are absorbed and return an empty object so callers can
 * treat any falsy result uniformly without try-catch boilerplate.
 *
 * @async
 * @param {string}      token           - The raw JWT string (leading/trailing whitespace is trimmed).
 * @param {string}      clientIp        - IP address of the requesting client (reserved for optional IP-lock).
 * @param {string|null} [cid=null]      - Tenant identifier. Required for non-admin tokens.
 * @param {boolean}     [isAdmin=false] - When `true`, validates against `JWT_ADMIN_SECRET`.
 * @returns {Promise<Object>} Decoded JWT payload, or `{}` on any validation failure.
 */
async function validateToken(token, clientIp, cid = null, isAdmin = false) {
    try {
        token = token?.trim();

        if (!token || token === 'null' || token === 'undefined') {
            return {};
        }

        let secret;

        if (isAdmin) {
            if (!JWT_ADMIN_SECRET) return {};
            secret = JWT_ADMIN_SECRET;
        } else {
            if (!cid) return {};

            secret = await getClientConfig(cid, 'login.jwtSecret');
            if (!secret) return {};
        }

        const decoded = jwt.verify(token, secret);

        // Optional IP check (disabled by default — enable when stricter
        // session binding is required):
        // if (decoded.ip !== clientIp) return {};

        return decoded || {};
    } catch {
        return {};
    }
}

// =============================================================================
// ADMIN TOKEN RENEWAL
// =============================================================================

/**
 * Renews an expired admin JWT within a five-minute grace window.
 *
 * The token is verified with `ignoreExpiration: true` so the payload can be
 * read even after the `exp` claim has passed. Renewal is denied when the
 * token is older than five minutes past its expiry, or when the embedded
 * role is not `'admin'`.
 *
 * @param {string} expiredToken - The expired admin JWT to renew.
 * @param {string} clientIp     - IP address of the requesting client (embedded in the new token).
 * @returns {string} A fresh admin JWT with a full `JWT_ADMIN_TTL` lifetime.
 * @throws {Error} When `JWT_ADMIN_SECRET` is not configured, the role is not
 *   `'admin'`, or the renewal window has closed.
 */
function renewAdminToken(expiredToken, clientIp) {
    if (!JWT_ADMIN_SECRET) {
        throw new Error('JWT_ADMIN_SECRET is not configured');
    }

    const decoded = jwt.verify(expiredToken, JWT_ADMIN_SECRET, { ignoreExpiration: true });

    if (decoded.role !== 'admin') {
        throw new Error('Only admins can renew');
    }

    const now            = Date.now();
    const expirationTime = decoded.exp * 1000;
    const maxRenewWindow = 5 * 60 * 1000;

    if (now > expirationTime + maxRenewWindow) {
        throw new Error('Late renewal');
    }

    return jwt.sign(
        {
            userId: decoded.userId,
            author: decoded.author,
            ip:     clientIp,
            email:  decoded.email,
            role:   decoded.role,
        },
        JWT_ADMIN_SECRET,
        { expiresIn: JWT_ADMIN_TTL }
    );
}

module.exports = { generateToken, validateToken, renewAdminToken };