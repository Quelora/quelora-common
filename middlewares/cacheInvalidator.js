/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middleware/cacheInvalidator.js */
const { cacheService } = require('../services/cacheService');

/**
 * Cache invalidation middleware.
 *
 * Invalidates Redis cache entries after a successful write operation
 * (POST, PUT, PATCH, DELETE).
 *
 * The invalidation is executed on the `finish` event to ensure that
 * only successful responses trigger cache cleanup.
 *
 * Supported invalidation strategies:
 * - Thread-level invalidation by entity and client ID (cid)
 * - Comment-level invalidation by comment ID
 */
function cacheInvalidator(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return;
    }

    const cid = req.cid;
    const params = extractRouteParams(req);

    if (params.entity && cid) {
      cacheService.deleteByPattern(`cid:${cid}:thread:${params.entity}:*`);
    }

    if (params.comment) {
      cacheService.deleteByPattern(`*:${params.comment}:*`);
    }
  });

  next();
}

/**
 * Extracts dynamic route parameters (entity, comment) from the request.
 *
 * Tries to use `req.params` first (most reliable). If that fails,
 * falls back to comparing the Express route definition against the
 * actual URL path. The fallback is defensive and handles non‑string
 * route paths (e.g., regular expressions) without throwing errors.
 */
function extractRouteParams(req) {
  // Prefer req.params if available – it already contains all named parameters
  if (req.params && typeof req.params === 'object') {
    // Return a shallow copy to avoid accidental mutations
    return { ...req.params };
  }

  // Fallback: manual extraction from route definition and actual URL
  if (
    !req.route ||
    !req.route.path ||
    !req._parsedUrl ||
    !req._parsedUrl.pathname
  ) {
    return {};
  }

  const routePath = req.route.path;
  let routeSegments;

  if (typeof routePath === 'string') {
    routeSegments = routePath.split('/').filter(Boolean);
  } else {
    // If route.path is not a string (e.g., a RegExp), we cannot reliably
    // extract named parameters. Log a warning and return empty.
    console.warn(
      `CacheInvalidator: cannot extract params from non‑string route.path: ${routePath}`
    );
    return {};
  }

  const actualSegments = req._parsedUrl.pathname.split('/').filter(Boolean);
  const offset = actualSegments.length - routeSegments.length;
  const params = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const segment = routeSegments[i];
    if (segment.startsWith(':')) {
      const paramName = segment.slice(1);
      params[paramName] = actualSegments[i + offset];
    }
  }

  return params;
}

module.exports = cacheInvalidator;