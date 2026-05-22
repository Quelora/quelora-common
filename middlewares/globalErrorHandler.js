/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middleware/globalErrorHandler.js */

/**
 * Global error handling middleware.
 *
 * Centralizes error responses and prevents leaking internal details
 * in production environments.
 *
 * Expected error shape:
 * - err.status (number, optional)
 * - err.message (string)
 */
function globalErrorHandler(err, req, res, next) {
  const statusCode = err.status || 500;

  console.error(
    '❌ Unhandled Error:',
    err.stack || err
  );

  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Unexpected error';

  res.status(statusCode).json({
    error: {
      message,
      status: statusCode
    }
  });
}

module.exports = globalErrorHandler;
