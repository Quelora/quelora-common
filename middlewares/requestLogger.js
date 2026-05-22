/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middleware/requestLogger.js */

/**
 * Request logging middleware.
 *
 * Logs basic request information once the response lifecycle
 * has finished, ensuring the final status code is available.
 *
 * Intended for development and lightweight production logging.
 */
function requestLogger(req, res, next) {
    res.on('finish', () => {
        const { method, path } = req;
        const statusCode = res.statusCode;

        switch (method) {
            case 'GET':
                console.log(`📌 GET ${path} → Status: ${statusCode}`);
                break;
            case 'POST':
                console.log(`🚀 POST ${path} → Status: ${statusCode}`);
                break;
            case 'PUT':
                console.log(`📝 PUT ${path} → Status: ${statusCode}`);
                break;
            case 'PATCH':
                console.log(`📝 PATCH ${path} → Status: ${statusCode}`);
                break;
            case 'DELETE':
                console.log(`🗑️ DELETE ${path} → Status: ${statusCode}`);
                break;
            default:
                console.log(`🔵 ${method} ${path} → Status: ${statusCode}`);
        }
    });

    next();
}

module.exports = requestLogger;