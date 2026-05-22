/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./config/helmetConfig.js

/**
 * Helmet configuration for securing HTTP headers.
 * Helmet helps protect the application from common web vulnerabilities
 * by setting various HTTP response headers.
 */

const helmet = require('helmet');

module.exports = helmet({
  // Content Security Policy is disabled here, but you can enable and configure it as needed.
  contentSecurityPolicy: false,

  // Frameguard is disabled; enable it if you need clickjacking protection (prevents iframe embedding).
  frameguard: false,

  // HTTP Strict Transport Security (HSTS) configuration
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true, // Apply HSTS to all subdomains
    preload: true, // Indicates readiness for inclusion in browser preload lists
  },

  // Prevents browsers from MIME-sniffing a response away from the declared content-type
  noSniff: true,

  // Removes the Referrer header; no referrer information will be sent
  referrerPolicy: { policy: 'no-referrer' },

  // Certificate Transparency enforcement
  expectCt: {
    maxAge: 86400, // 1 day in seconds
    enforce: true, // Enforce Certificate Transparency
  },

  // Restricts resource loading to the same origin
  crossOriginResourcePolicy: { policy: 'same-origin' },

  // Enables XSS protection in supporting browsers
  xssFilter: true,

  // Hides the 'X-Powered-By' header to avoid exposing server technology information
  hidePoweredBy: true,
});
