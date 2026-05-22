/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-common/constants/queues.js

/**
 * Registry of all queue names used across the system.
 * Single source of truth for producers (quelora-jobs),
 * consumers (quelora-worker), and the dashboard API.
 *
 * Usage:
 *   const { QUEUES } = require('@quelora/common/constants/queues');
 *   const queue = getQueue(QUEUES.REPUTATION);
 */

const QUEUES = {
    // --- Scheduled job queues (triggered by quelora-jobs) ---
    REPUTATION:    'reputation-jobs',
    SUGGESTION:    'suggestion-jobs',
    SYSTEM:        'system-jobs',
    ENTERPRISE:    'enterprise-jobs',
    ACTIVITY:      'activity-jobs',
    GRAVITY:       'gravity-decay',

    // --- Event-driven queues (triggered by API actions) ---
    EMAILS:        'emails',
    NOTIFICATIONS: 'notifications',
    AGGREGATION:   'aggregation',
};

module.exports = { QUEUES };