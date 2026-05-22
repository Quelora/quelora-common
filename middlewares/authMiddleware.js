/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// middlewares/authMiddleware.js
const { validateToken } = require('@quelora/common/services/authService');

/**
 * Authentication middleware.
 *
 * - Extracts and validates a Bearer token from the Authorization header.
 * - Dynamically resolves the JWT secret using the client identifier (CID) for tenant users.
 * - Binds the authenticated user payload to `req.user`.
 * - Validates the IP binding if provided.
 *
 * Responds with 401 if the token is missing, malformed, or invalid.
 * Responds with 400 if the client context (CID) is missing for non-admin requests.
 *
 * @async
 * @function authMiddleware
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authorization token missing or malformed.'
    });
  }

  const token = authHeader.slice(7);
  const clientIp = req.ip;
  
  const cid = req.cid || req.headers['x-client-id'] || req.headers['X-Client-ID'];

  if (!cid) {
    return res.status(400).json({
      message: 'Client context missing. Cannot validate tenant token.'
    });
  }

  try {
    const payload = await validateToken(token, clientIp, cid, false);

    req.user = payload;

    return next();
  } catch (error) {
    return res.status(401).json({
      message: error.message || 'Invalid or expired token.'
    });
  }
}

module.exports = authMiddleware;