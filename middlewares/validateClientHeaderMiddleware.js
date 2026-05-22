/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/middlewares/validateClientHeaderMiddleware.js */
const { getClientConfig, getClientCached } = require('../services/clientConfigService');

/**
 * Validates the presence and correctness of the client identifier header.
 * * ARCHITECTURAL UPDATE:
 * - Uses 'getClientCached' (Defense Line 2) to validate existence efficiently.
 * - Injects both 'req.client' (Full Document) and 'req.clientConfig' (Decrypted Config).
 * - Acts as the primary firewall for invalid tenants.
 * * SSE UPDATE:
 * - Supports CID via Query Params strictly for '/stream' endpoints (EventSource limitation).
 */
const validateClientHeader = async (req, res, next) => {
    let cid = req.headers['x-client-id'];

    // EXCEPTION FOR SSE/STREAMS:
    // EventSource (native browser API) cannot send custom headers. 
    // We allow 'cid' extraction from Query Params ONLY if the request targets a stream endpoint.
    // We use req.originalUrl to ensure we catch the full path (e.g., /notifications/stream).
    if (!cid) {
        const isStreamRequest = req.originalUrl.includes('/stream') || req.path.includes('/stream');
        
        if (isStreamRequest) {
            cid = req.query.cid;
        }
    }

    if (!cid) {
        return res.status(400).json({ error: 'Header X-Client-Id is required' });
    }

    try {
        // 1. Fast Existence Check & Full Document Retrieval
        // This hits the "Full" cache key. If missing, hits DB once and caches it.
        const clientDoc = await getClientCached(cid);

        if (!clientDoc) {
            console.warn(`[ClientHeader] Unknown CID access attempt: ${cid}`);
            return res.status(403).json({ error: 'Invalid client ID' });
        }

        // 2. Config Retrieval
        // This hits the "Config" cache key (decrypted). If missing, it derives it.
        const clientConfig = await getClientConfig(cid);

        if (!clientConfig) {
            // Should theoretically not happen if clientDoc exists, but acts as integrity check
            console.error(`[ClientHeader] Config missing for existing CID: ${cid}`);
            return res.status(500).json({ error: 'Client configuration unavailable' });
        }

        // 3. Context Injection
        req.cid = cid;
        req.client = clientDoc;      // Full Model (Lean) for structural needs (e.g. resilience keys, urls)
        req.clientConfig = clientConfig; // Decrypted Config for functional needs (e.g. captcha, geo)

        next();
    } catch (error) {
        console.error('[ClientHeader] Validation panic:', error);
        return res.status(500).json({ error: 'Failed to validate client context' });
    }
};

module.exports = validateClientHeader;