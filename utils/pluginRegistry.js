/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/utils/pluginRegistry.js */
/**
 * Centralised plugin & feature registry for the Quelora widget.
 *
 * Each entry maps a logical module name to:
 *  - `features`  {Object}  — feature-flag keys injected into ConfModule / worker init.
 *  - `ui`        {Array}   — UI-thread plugins (name + relative path from widget bundle root).
 *  - `worker`    {Array}   — Worker-thread plugins (name + relative path from widget bundle root).
 *
 * Paths are intentionally relative so the widget can prepend `currentScriptPath`
 * at runtime, keeping the registry environment-agnostic.
 *
 * `buildPluginManifest(enterpriseModules, communityPlugins)` is the "path
 * constructor": given the arrays of enabled module/plugin names stored on a
 * Client document, it returns the complete `{ features, plugins }` object that
 * `getClientWidgetConfig` embeds in the public widget config.
 */

// =============================================================================
// ENTERPRISE MODULE REGISTRY
// =============================================================================

const ENTERPRISE_MODULE_REGISTRY = {
    surveys: {
        features: {},
        ui: [
            { name: 'Survey', path: '../enterprise/survey/survey.js' },
        ],
        worker: [],
    },

    gamification: {
        features: {},
        ui: [
            { name: 'Gamefication', path: '../enterprise/gamification/gamification.js' },
        ],
        worker: [],
    },

    advertising: {
        features: {},
        ui: [
            { name: 'AdsModule', path: '../enterprise/banana/banana-engine.js' },
        ],
        worker: [],
    },

    /**
     * `network` activates SSE (real-time notifications) and the integrated chat.
     */
    network: {
        features: { sse: true, chat: true },
        ui: [
            { name: 'SSEService', path: '../enterprise/sse/services/sse.js' },
            { name: 'Chat',       path: '../enterprise/chat/chat.js'        },
        ],
        worker: [
            { name: 'ActivitiesWorkerDB', path: '../enterprise/sse/worker/notifications/activitiesWorker.db.js' },
            { name: 'SSEWorker',          path: '../enterprise/sse/worker/sse/sseWorker.js'                      },
            { name: 'ChatWorker',         path: '../enterprise/chat/worker/chatWorker.js'                        },
        ],
    },

    /**
     * `resilience` activates P2P delivery and the offline fallback layer.
     */
    resilience: {
        features: { p2p: true },
        ui: [
            { name: 'P2P',          path: '../enterprise/p2p/p2p.js'                           },
            { name: 'TrackerBridge',path: '../enterprise/p2p/tracker-bridge.js'                 },
            { name: 'Resilience',   path: '../enterprise/resilience/resilience.js'              },
        ],
        worker: [
            { name: 'ResilienceManager', path: '../enterprise/resilience/worker/resilienceManager.js'  },
            { name: 'ResilienceCrypto',  path: '../enterprise/resilience/worker/resilienceWorker.js'   },
            { name: 'FallbackDB',        path: '../enterprise/resilience/worker/fallbackWorker.db.js'  },
        ],
    },

    /**
     * `push` enables Web Push notifications.
     * Shares ActivitiesWorkerDB with `network`; dedup is handled by `buildPluginManifest`.
     */
    push: {
        features: {},
        ui: [],
        worker: [
            { name: 'ActivitiesWorkerDB', path: '../enterprise/sse/worker/notifications/activitiesWorker.db.js' },
        ],
    },

    /**
     * `liveMode` enables live comment streams and the live-stats UI dot.
     * Requires SSE (activates the `sse` feature flag).
     */
    liveMode: {
        features: { sse: true },
        ui: [
            { name: 'Live',        path: '../enterprise/live/live.ui.js' },
            { name: 'LiveService', path: '../enterprise/live/live.js'    },
        ],
        worker: [],
    },
};

// =============================================================================
// COMMUNITY PLUGIN REGISTRY
// =============================================================================

const COMMUNITY_PLUGIN_REGISTRY = {
    /**
     * `sentinel` — Content-safety overlay (community edition).
     */
    sentinel: {
        features: {},
        ui: [
            { name: 'Sentinel', path: '../plugins/sentinel/sentinel.js' },
        ],
        worker: [],
    },

    /**
     * `placer` — Dynamic interaction-bar placement helper.
     */
    placer: {
        features: { interactionPlacer: true },
        ui: [
            { name: 'Placer', path: '../plugins/placer/interaction-placer.js' },
        ],
        worker: [],
    },
};

// =============================================================================
// VALID NAME LISTS (used for validation in the API layer)
// =============================================================================

const VALID_ENTERPRISE_MODULES  = Object.keys(ENTERPRISE_MODULE_REGISTRY);
const VALID_COMMUNITY_PLUGINS   = Object.keys(COMMUNITY_PLUGIN_REGISTRY);

// =============================================================================
// PATH CONSTRUCTOR
// =============================================================================

/**
 * Builds the complete `{ features, plugins }` manifest from the arrays of
 * enabled module/plugin names stored on a Client document.
 *
 * Duplicate plugin entries (e.g. `ActivitiesWorkerDB` appearing in both
 * `network` and `push`) are deduplicated by plugin name — first occurrence wins.
 *
 * @param {string[]} [enterpriseModules=[]] - Enabled enterprise module keys.
 * @param {string[]} [communityPlugins=[]]  - Enabled community plugin keys.
 * @returns {{ features: Object, plugins: { ui: Array, worker: Array } }}
 */
function buildPluginManifest(enterpriseModules = [], communityPlugins = []) {
    const features    = {};
    const uiPlugins   = [];
    const workerPlugins = [];
    const uiSeen      = new Set();
    const workerSeen  = new Set();

    const collect = (registry, keys) => {
        for (const key of keys) {
            const entry = registry[key];
            if (!entry) continue;

            Object.assign(features, entry.features);

            for (const p of entry.ui) {
                if (!uiSeen.has(p.name)) {
                    uiPlugins.push(p);
                    uiSeen.add(p.name);
                }
            }

            for (const p of entry.worker) {
                if (!workerSeen.has(p.name)) {
                    workerPlugins.push(p);
                    workerSeen.add(p.name);
                }
            }
        }
    };

    collect(ENTERPRISE_MODULE_REGISTRY, enterpriseModules);
    collect(COMMUNITY_PLUGIN_REGISTRY,  communityPlugins);

    return {
        features,
        plugins: { ui: uiPlugins, worker: workerPlugins },
    };
}

module.exports = {
    ENTERPRISE_MODULE_REGISTRY,
    COMMUNITY_PLUGIN_REGISTRY,
    VALID_ENTERPRISE_MODULES,
    VALID_COMMUNITY_PLUGINS,
    buildPluginManifest,
};
