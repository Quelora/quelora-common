/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./config/corsClientConfig.js
const clientConfigService  = require('../services/clientConfigService');

async function clientCorsConfig(req, callback) {
  try {
    const cid = req.headers['x-client-id'];
    if (!cid) {
      return callback(null, { origin: false });
    }

    const clientConfig = await clientConfigService.getClientConfig(cid);
  
    if (!clientConfig?.cors?.enabled) {
      return callback(null, { origin: false });
    }

    const corsOptions = {
      origin: clientConfig.cors.allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id', 'X-Ip', 'X-Country', 'X-Region', 'X-City','X-Captcha-Token','X-Survey-Fingerprint','X-Guest-ID'],
      credentials: true,
      maxAge: 86400
    };

    callback(null, corsOptions);
  } catch (error) {
    console.error('Error in client CORS config:', error);
    callback(null, { origin: false });
  }
}

module.exports = clientCorsConfig;