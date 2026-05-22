/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./services/toxicityService.js
const PerspectiveToxicityProvider = require('../toxicityProviders/PerspectiveToxicityProvider');
const DetoxifiToxicityProvider = require('../toxicityProviders/DetoxifiToxicityProvider');

/**
 * Orchestrates the toxicity analysis using the configured provider and evaluates
 * the normalized scores against the client's granular thresholds.
 *
 * @async
 * @param {string} text - The text to analyze.
 * @param {string} [language='es'] - The ISO 639-1 language code.
 * @param {Object} [clientConfig={}] - The client's toxicity configuration.
 * @param {string} [cid='UNKNOWN'] - The Client ID for logging purposes.
 * @returns {Promise<{isPolite: boolean|null, scores: Object|null}>} The evaluation result and normalized scores.
 */
async function toxicityService(text, language = 'es', clientConfig = {}, cid = 'UNKNOWN') {
    if (!clientConfig || Object.keys(clientConfig).length === 0) {
        return { isPolite: null, scores: null };
    }

    if (clientConfig.enabled === false) {
        return { isPolite: true, scores: {} };
    }

    const providerName = (clientConfig.provider || 'perspective').toLowerCase();
    let providerConfig = {};

    const providerDetailsKey = Object.keys(clientConfig.providerDetails || {}).find(
        k => k.toLowerCase() === providerName
    );
    if (providerDetailsKey) {
        providerConfig = clientConfig.providerDetails[providerDetailsKey];
    } else {
        providerConfig = {
            apiKey: clientConfig.apiKey,
            url: clientConfig.url,
            configJson: clientConfig.configJson,
            languages: clientConfig.configJson?.languages,
            doNotStore: clientConfig.configJson?.doNotStore
        };
    }

    let provider;
    switch (providerName) {
        case 'perspective':
            provider = new PerspectiveToxicityProvider(providerConfig, cid);
            break;
        case 'detoxifi':
            provider = new DetoxifiToxicityProvider(providerConfig, cid);
            break;
        default:
            console.error(`[ToxicityService] Unsupported provider: ${providerName} for CID: ${cid}`);
            return { isPolite: null, scores: null };
    }

    try {
        const scores = await provider.analyze(text, language);

        const legacyThreshold = clientConfig.threshold !== undefined ? clientConfig.threshold : 0.8;
        const thresholds = clientConfig.thresholds || {
            toxicity: legacyThreshold,
            severe_toxicity: legacyThreshold,
            obscene: legacyThreshold,
            threat: legacyThreshold,
            insult: legacyThreshold,
            identity_attack: legacyThreshold
        };

        let isPolite = true;
        for (const [metric, score] of Object.entries(scores)) {
            const limit = thresholds[metric] !== undefined ? thresholds[metric] : 0.8;
            if (score >= limit) {
                isPolite = false;
                break;
            }
        }

        return { isPolite, scores };
    } catch (error) {
        console.error(`[ToxicityService] Error orchestrating analysis for CID ${cid}:`, error.message);
        return { isPolite: null, scores: null };
    }
}

module.exports = { toxicityService };