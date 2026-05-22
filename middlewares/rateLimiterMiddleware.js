/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: ./middlewares/rateLimiterMiddleware.js */
const rateLimit = require('express-rate-limit');

/**
 * Global rate limiter.
 *
 * Applies a general request limit per IP to protect the API
 * from abusive traffic and accidental floods.
 */
const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // Max requests per IP
  message: 'Too many requests. Please try again later. [Global]',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Strict rate limiter.
 *
 * Intended for sensitive or high-impact endpoints that should
 * not be accessed repeatedly in short periods of time.
 */
const strictRateLimiter = rateLimit({
  windowMs: 2 * 1000, // 2 seconds
  max: 10,
  message: 'Too many requests. Please slow down. [Strict]',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Login rate limiter.
 *
 * Protects authentication endpoints against brute-force attacks.
 */
const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: {
    error: 'Too many login attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  globalRateLimiter,
  strictRateLimiter,
  loginRateLimiter
};
