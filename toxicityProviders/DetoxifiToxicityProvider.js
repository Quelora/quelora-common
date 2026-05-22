/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./toxicityProviders/DetoxifiToxicityProvider.js
const axios = require('axios');
const ToxicityProvider = require('./ToxicityProvider');

/**
 * Concrete implementation of ToxicityProvider for the Detoxifi local/external service.
 * Expects a native 1:1 mapping with the normalized application schema but enforces strict type casting.
 *
 * @class DetoxifiToxicityProvider
 * @extends ToxicityProvider
 */
class DetoxifiToxicityProvider extends ToxicityProvider {
    /**
     * Creates an instance of DetoxifiToxicityProvider.
     *
     * @param {Object} providerConfig - Configuration specific to Detoxifi (url, optional apiKey/token).
     * @param {string} cid - The Client ID.
     */
    constructor(providerConfig, cid) {
        super(providerConfig, cid);
        this.apiUrl = this.providerConfig.url || 'http://localhost:8000/moderate';
        this.apiKey = this.providerConfig.apiKey; 
    }

    /**
     * Executes the analysis against the Detoxifi service.
     * Maps the native response directly to the normalized schema, ensuring strict type compliance.
     *
     * @protected
     * @async
     * @param {string} text - The text to analyze.
     * @param {string} language - ISO 639-1 language code.
     * @returns {Promise<{
     * toxicity: number,
     * severe_toxicity: number,
     * obscene: number,
     * threat: number,
     * insult: number,
     * identity_attack: number
     * }>} Normalized scores. Defaults to 0.0 if the service fails.
     */
    async _performAnalysis(text, language) {
        const postBody = {
            text: text,
            language: language
        };

        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const response = await axios.post(this.apiUrl, postBody, { headers });
            const scores = response.data;

            return {
                toxicity: parseFloat(scores.toxicity) || 0.0,
                severe_toxicity: parseFloat(scores.severe_toxicity) || 0.0,
                obscene: parseFloat(scores.obscene) || 0.0,
                threat: parseFloat(scores.threat) || 0.0,
                insult: parseFloat(scores.insult) || 0.0,
                identity_attack: parseFloat(scores.identity_attack) || 0.0
            };
        } catch (error) {
            const apiErrorMessage = error.response?.data?.error || error.message;
            console.error(`[DetoxifiToxicityProvider] Service Error for CID ${this.cid}:`, apiErrorMessage);
            return this._getDefaultScores();
        }
    }

    /**
     * Helper method to return safe default scores in case of network failure or malformed response.
     * Ensures the application degrades gracefully.
     *
     * @private
     * @returns {{
     * toxicity: number,
     * severe_toxicity: number,
     * obscene: number,
     * threat: number,
     * insult: number,
     * identity_attack: number
     * }} Zeroed out scores.
     */
    _getDefaultScores() {
        return {
            toxicity: 0.0,
            severe_toxicity: 0.0,
            obscene: 0.0,
            threat: 0.0,
            insult: 0.0,
            identity_attack: 0.0
        };
    }
}

module.exports = DetoxifiToxicityProvider;