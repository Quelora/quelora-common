/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./toxicityProviders/PerspectiveToxicityProvider.js
const axios = require('axios');
const ToxicityProvider = require('./ToxicityProvider');

/**
 * Concrete implementation of ToxicityProvider for Google Perspective API.
 * Maps the proprietary Google response structure into the application's normalized format.
 *
 * @class PerspectiveToxicityProvider
 * @extends ToxicityProvider
 */
class PerspectiveToxicityProvider extends ToxicityProvider {
    /**
     * Creates an instance of PerspectiveToxicityProvider.
     *
     * @param {Object} providerConfig - Configuration specific to Perspective (apiKey, url, doNotStore, etc.).
     * @param {string} cid - The Client ID.
     */
    constructor(providerConfig, cid) {
        super(providerConfig, cid);
        this.apiUrl = this.providerConfig.url || 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';
        this.apiKey = this.providerConfig.apiKey;
    }

    /**
     * Executes the analysis against Google Perspective API and normalizes the output.
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
     * }>} Normalized scores. Defaults to 0.0 if the API fails.
     */
    async _performAnalysis(text, language) {
        if (!this.apiKey) {
            console.error(`[PerspectiveToxicityProvider] Missing API Key for CID: ${this.cid}`);
            return this._getDefaultScores();
        }

        const requestedAttributes = {
            TOXICITY: {},
            SEVERE_TOXICITY: {},
            PROFANITY: {}, 
            THREAT: {},
            INSULT: {},
            IDENTITY_ATTACK: {}
        };

        const languages = this.providerConfig.languages && Array.isArray(this.providerConfig.languages) && this.providerConfig.languages.length > 0
            ? this.providerConfig.languages
            : [language];

        const postBody = {
            comment: { text },
            languages: languages,
            requestedAttributes: requestedAttributes,
            doNotStore: this.providerConfig.doNotStore !== undefined ? this.providerConfig.doNotStore : true
        };

        try {
            const response = await axios.post(`${this.apiUrl}?key=${this.apiKey}`, postBody);
            const scores = response.data.attributeScores;

            return {
                toxicity: scores.TOXICITY?.summaryScore?.value || 0.0,
                severe_toxicity: scores.SEVERE_TOXICITY?.summaryScore?.value || 0.0,
                obscene: scores.PROFANITY?.summaryScore?.value || 0.0,
                threat: scores.THREAT?.summaryScore?.value || 0.0,
                insult: scores.INSULT?.summaryScore?.value || 0.0,
                identity_attack: scores.IDENTITY_ATTACK?.summaryScore?.value || 0.0
            };
        } catch (error) {
            const apiErrorMessage = error.response?.data?.error?.message || error.message;
            console.error(`[PerspectiveToxicityProvider] API Error for CID ${this.cid}:`, apiErrorMessage);
            return this._getDefaultScores();
        }
    }

    /**
     * Helper method to return safe default scores in case of network failure or missing configuration.
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

module.exports = PerspectiveToxicityProvider;