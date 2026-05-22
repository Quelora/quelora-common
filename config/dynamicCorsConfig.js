/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./config/dynamicCorsConfig.js

require('dotenv').config();
const { getClientConfig } = require('../services/clientConfigService');
const { DASHBOARD_URL, BASE_URL, CLIENT_URL } = process.env;

/**
 * Dynamic CORS Configuration.
 * Configures Allowed Origins and Exposed Headers based on Client ID (CID).
 *
 * @param {Object} req - Express Request Object.
 * @param {Function} callback - Callback function (err, corsOptions).
 */
async function dynamicCorsConfig(req, callback) {
  const defaultOrigins = [DASHBOARD_URL, BASE_URL, CLIENT_URL];

  try {
    let cid = req.headers['x-client-id'] || req.headers['X-Client-ID'];

    if (!cid) {
      const isStreamRequest = req.originalUrl.includes('/stream') || req.path.includes('/stream');
      if (isStreamRequest) {
          cid = req.query.cid;
      }
    }

    const baseCorsOptions = {
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Client-ID',
        'X-Guest-ID',
        'X-Ip',
        'X-Country',
        'X-Country-Code',
        'X-Region-Code',
        'X-Region',
        'X-City',
        'X-Lat',
        'X-Lon',
        'X-Captcha-Token',
        'X-Survey-Fingerprint',
        'X-Password-Reset-Token',
        'X-Peer-ID',
      ],
      exposedHeaders: [
        'X-Captcha-Token',
        'X-Cache-Compressor',
        'X-Cache-App',
        'X-Ip',
        'X-Country',
        'X-Country-Code',
        'X-Region-Code',
        'X-Region',
        'X-City',
        'X-Lat',
        'X-Lon',
        'X-Cache-Bin',
        'X-Sidecar',
        'X-Resilience-Scope',
        'X-Resilience-Mode',
        'X-Resilience-Bootstrap'
      ],
      credentials: true,
      maxAge: 86400
    };

    if (req.method === 'OPTIONS') {
      return callback(null, { ...baseCorsOptions, origin: true });
    }

    const corsOptions = {
      ...baseCorsOptions,
      origin: async (origin, cb) => {
        if (!origin) return cb(null, true);

        let allowedOrigins = [...new Set(defaultOrigins.filter(Boolean))];

        if (cid) {
          try {
            const clientConfig = await getClientConfig(cid);
            if (clientConfig?.cors?.enabled && Array.isArray(clientConfig.cors.allowedOrigins)) {
              const clientOrigins = clientConfig.cors.allowedOrigins.filter(Boolean);
              allowedOrigins = [...new Set([...allowedOrigins, ...clientOrigins])];
            }
          } catch (err) {
            console.error(`Error fetching client config for CID ${cid}:`, err);
          }
        }

        if (allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          console.log(`Origin blocked: ${origin} - Allowed: ${allowedOrigins.join(', ')}`);
          cb(new Error('Not allowed by CORS'));
        }
      }
    };

    callback(null, corsOptions);
  } catch (error) {
    console.error('CORS Error:', error);
    callback(null, { origin: false });
  }
}

module.exports = dynamicCorsConfig;