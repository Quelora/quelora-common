/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./toxicityProviders/ToxicityProvider.js

/**
 * Abstract base class for all Toxicity Providers.
 * Ensures a consistent interface and normalized output for toxicity analysis across different underlying services.
 *
 * @class ToxicityProvider
 */
class ToxicityProvider {
    /**
     * Creates an instance of ToxicityProvider.
     *
     * @param {Object} providerConfig - Specific configuration for the provider (e.g., apiKey, url, settings).
     * @param {string} cid - The Client ID associated with the request.
     * @throws {TypeError} If an attempt is made to instantiate the abstract class directly.
     */
    constructor(providerConfig, cid) {
        if (new.target === ToxicityProvider) {
            throw new TypeError("Cannot construct abstract instances of ToxicityProvider directly.");
        }
        this.providerConfig = providerConfig || {};
        this.cid = cid;
    }

    /**
     * Public interface to execute the toxicity analysis.
     * Delegates the specific implementation to the _performAnalysis method of the subclass.
     *
     * @async
     * @param {string} text - The text content to analyze.
     * @param {string} [language='es'] - The ISO 639-1 language code of the text.
     * @returns {Promise<{
     * toxicity: number,
     * severe_toxicity: number,
     * obscene: number,
     * threat: number,
     * insult: number,
     * identity_attack: number
     * }>} A normalized object containing the toxicity scores ranging from 0.0 to 1.0.
     */
    async analyze(text, language = 'es') {
        return await this._performAnalysis(text, language);
    }

    /**
     * Abstract method to perform the actual API call or local analysis.
     * Must be implemented by all concrete provider subclasses.
     *
     * @protected
     * @async
     * @param {string} text - The text content to analyze.
     * @param {string} language - The ISO 639-1 language code.
     * @returns {Promise<{
     * toxicity: number,
     * severe_toxicity: number,
     * obscene: number,
     * threat: number,
     * insult: number,
     * identity_attack: number
     * }>} The normalized score object. Unmapped or unsupported metrics must default to 0.
     * @throws {Error} If the method is not implemented by the subclass.
     */
    async _performAnalysis(text, language) {
        throw new Error('_performAnalysis must be implemented by the concrete toxicity provider subclass.');
    }
}

module.exports = ToxicityProvider;