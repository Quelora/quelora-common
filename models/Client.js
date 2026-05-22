/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// packages/quelora-common/models/Client.js
const { mongoose } = require('../db');
const { encrypt, decrypt } = require('../utils/cipher');
const Post = require('./Post');
const { cacheService } = require('../services/cacheService');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const allowedConfigKeys = [
    'login', 'moderation', 'toxicity', 'translation', 'geolocation',
    'cors', 'language', 'entityConfig',
    'captcha', 'authWidget', 'giphy'
];

/**
 * Invalidates all cache keys associated with a given Client CID.
 * Covers all cache key patterns used by `clientConfigService.js` across all Defense Lines.
 *
 * @async
 * @function invalidateClientCache
 * @param {string} cid - The unique Client ID whose cache entries should be purged.
 * @returns {Promise<void>}
 */
async function invalidateClientCache(cid) {
    if (!cid) return;
    const baseKey = `client:config:${cid}`;
    const keysToDelete = [
        `${baseKey}:full`,
        baseKey,
        `${baseKey}:post`,
        `${baseKey}:vapid`,
        `${baseKey}:email`,
        `${baseKey}:turn`,
        `${baseKey}:nostr`,
        `${baseKey}:p2p`,
        `${baseKey}:resilience`,
        `${baseKey}:giphy`,
        `${baseKey}:widget`,
        `${baseKey}:modules`,
    ];

    try {
        await Promise.all(keysToDelete.map(key => cacheService.delete(key)));
    } catch (error) {
        console.error(`[Cache] Failed to invalidate keys for CID ${cid}:`, error);
    }
}

/**
 * @typedef {Object} JobConfig
 * @property {boolean} enabled - Whether the scheduled job is active.
 * @property {string} cronExpression - Cron expression defining the schedule.
 * @property {Object} options - Arbitrary provider-specific options.
 */
const jobConfigSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    cronExpression: { type: String, default: '0 0 * * *' },
    options: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

/**
 * Mongoose schema for the `Client` collection.
 * Represents a tenant in the Quelora platform and holds all per-client configuration,
 * including authentication, moderation, push notifications, email, WebRTC TURN credentials, and P2P options.
 */
const clientSchema = new mongoose.Schema({
    users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    }],
    cid: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        unique: true,
        match: [/^QU-[A-Z0-9]{8}-[A-Z0-9]{5}$/, 'Invalid CID format. Must be QU-XXXXXXXX-XXXXX']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [50, 'Description cannot exceed 50 characters']
    },
    apiUrl: {
        type: String,
        trim: true,
        maxlength: [300, 'ApiURL cannot exceed 300 characters']
    },
    siteUrl: {
        type: String,
        trim: true,
        maxlength: [300, 'SiteURL cannot exceed 300 characters']
    },
    config: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: true
    },
    jobsConfig: {
        reputation: {
            type: jobConfigSchema,
            default: { enabled: true, cronExpression: '*/30 * * * * *' }
        },
        suggestion: {
            type: jobConfigSchema,
            default: { enabled: true, cronExpression: '0 2 * * *' }
        }
    },
    postConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: true
    },
    vapid: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },
    email: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },
    resilience: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },
    turn: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },
    nostr: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },
    p2p: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        required: false
    },

    /**
     * Enterprise modules enabled for this client.
     * Managed exclusively by god-level users via PATCH /client/:cid/modules.
     * Valid values are defined in pluginRegistry.VALID_ENTERPRISE_MODULES.
     */
    enterpriseModules: {
        type: [String],
        default: [],
    },

    /**
     * Community plugins enabled for this client.
     * Managed by admin-level users via PATCH /client/:cid/modules.
     * Valid values are defined in pluginRegistry.VALID_COMMUNITY_PLUGINS.
     */
    communityPlugins: {
        type: [String],
        default: [],
    },

    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

/**
 * Returns a deep copy of `this.config` with all encrypted cipher fields replaced
 * by their decrypted plain-text counterparts.
 *
 * Includes Giphy: when `config.giphy.apiKeyCipher` is present it is decrypted
 * back to `apiKey` so the proxy route can use it at runtime without ever
 * reading the raw cipher value outside the model layer.
 *
 * @method decryptConf
 * @memberof ClientSchema.methods
 * @returns {Object} Decrypted configuration object.
 */
clientSchema.methods.decryptConf = function() {
    const conf = JSON.parse(JSON.stringify(this.config));

    if (conf.login?.providerDetails) {
        for (const provider of Object.values(conf.login.providerDetails)) {
            if (provider.clientSecretCipher) {
                provider.clientSecret = decrypt(provider.clientSecretCipher, ENCRYPTION_KEY);
                delete provider.clientSecretCipher;
            }
        }
    }

    const modulesToDecrypt = ['moderation', 'translation'];
    for (const moduleName of modulesToDecrypt) {
        if (conf[moduleName]?.apiKeyCipher) {
            conf[moduleName].apiKey = decrypt(conf[moduleName].apiKeyCipher, ENCRYPTION_KEY);
            delete conf[moduleName].apiKeyCipher;
        }
    }

    if (conf.toxicity) {
        if (conf.toxicity.apiKeyCipher) {
            conf.toxicity.apiKey = decrypt(conf.toxicity.apiKeyCipher, ENCRYPTION_KEY);
            delete conf.toxicity.apiKeyCipher;
        }
        if (conf.toxicity.providerDetails) {
            for (const provider of Object.values(conf.toxicity.providerDetails)) {
                if (provider.apiKeyCipher) {
                    provider.apiKey = decrypt(provider.apiKeyCipher, ENCRYPTION_KEY);
                    delete provider.apiKeyCipher;
                }
            }
        }
    }

    if (conf.geolocation) {
        if (conf.geolocation.frontend?.apiKeyCipher) {
            conf.geolocation.frontend.apiKey = decrypt(conf.geolocation.frontend.apiKeyCipher, ENCRYPTION_KEY);
            delete conf.geolocation.frontend.apiKeyCipher;
        }
        if (conf.geolocation.backend?.apiKeyCipher) {
            conf.geolocation.backend.apiKey = decrypt(conf.geolocation.backend.apiKeyCipher, ENCRYPTION_KEY);
            delete conf.geolocation.backend.apiKeyCipher;
        }
        if (conf.geolocation.apiKeyCipher) {
            conf.geolocation.apiKey = decrypt(conf.geolocation.apiKeyCipher, ENCRYPTION_KEY);
            delete conf.geolocation.apiKeyCipher;
        }
    }

    if (conf.login?.jwtSecretCipher) {
        conf.login.jwtSecret = decrypt(conf.login.jwtSecretCipher, ENCRYPTION_KEY);
        delete conf.login.jwtSecretCipher;
    }

    if (conf.captcha?.secretKeyCipher) {
        conf.captcha.secretKey = decrypt(conf.captcha.secretKeyCipher, ENCRYPTION_KEY);
        delete conf.captcha.secretKeyCipher;
    }
    if (conf.captcha?.credentialsJsonCipher) {
        conf.captcha.credentialsJson = decrypt(conf.captcha.credentialsJsonCipher, ENCRYPTION_KEY);
        delete conf.captcha.credentialsJsonCipher;
    }

    if (conf.giphy?.apiKeyCipher) {
        conf.giphy.apiKey = decrypt(conf.giphy.apiKeyCipher, ENCRYPTION_KEY);
        delete conf.giphy.apiKeyCipher;
    }

    return conf;
};

/**
 * Returns a deep copy of `this.vapid` with the private key decrypted.
 *
 * @method decryptVapid
 * @memberof ClientSchema.methods
 * @returns {Object} Decrypted VAPID object.
 */
clientSchema.methods.decryptVapid = function() {
    const vapid = JSON.parse(JSON.stringify(this.vapid || {}));
    if (vapid.privateKeyCipher) {
        vapid.privateKey = decrypt(vapid.privateKeyCipher, ENCRYPTION_KEY);
        delete vapid.privateKeyCipher;
    }
    return vapid;
};

/**
 * Returns a deep copy of `this.email` with the SMTP password decrypted.
 *
 * @method decryptEmail
 * @memberof ClientSchema.methods
 * @returns {Object} Decrypted email configuration object.
 */
clientSchema.methods.decryptEmail = function() {
    const email = JSON.parse(JSON.stringify(this.email || {}));
    if (email.smtp_passCipher) {
        email.smtp_pass = decrypt(email.smtp_passCipher, ENCRYPTION_KEY);
        delete email.smtp_passCipher;
    }
    return email;
};

/**
 * Returns a deep copy of `this.resilience` with the private key decrypted.
 * Returns `null` if decryption fails.
 *
 * @method decryptResilience
 * @memberof ClientSchema.methods
 * @returns {Object|null} Decrypted resilience configuration, or `null` on error.
 */
clientSchema.methods.decryptResilience = function() {
    const resilience = JSON.parse(JSON.stringify(this.resilience || {}));
    if (resilience.privateKeyCipher) {
        try {
            resilience.privateKey = decrypt(resilience.privateKeyCipher, ENCRYPTION_KEY);
            delete resilience.privateKeyCipher;
        } catch (e) {
            console.error('Error decrypting resilience private key', e);
            return null;
        }
    }
    return resilience;
};

/**
 * Returns a deep copy of `this.turn` with the HMAC static auth secret decrypted.
 *
 * @method decryptTurn
 * @memberof ClientSchema.methods
 * @returns {Object} Decrypted TURN configuration object.
 */
clientSchema.methods.decryptTurn = function() {
    const turn = JSON.parse(JSON.stringify(this.turn || {}));
    if (turn.staticAuthSecretCipher) {
        turn.staticAuthSecret = decrypt(turn.staticAuthSecretCipher, ENCRYPTION_KEY);
        delete turn.staticAuthSecretCipher;
    }
    return turn;
};

/**
 * Returns a deep copy of `this.nostr` with the relay auth secret decrypted.
 *
 * @method decryptNostr
 * @memberof ClientSchema.methods
 * @returns {Object} Decrypted Nostr configuration object.
 */
clientSchema.methods.decryptNostr = function() {
    const nostr = JSON.parse(JSON.stringify(this.nostr || {}));
    if (nostr.authSecretCipher) {
        nostr.authSecret = decrypt(nostr.authSecretCipher, ENCRYPTION_KEY);
        delete nostr.authSecret;
    }
    return nostr;
};

/**
 * Dispatches module-level validation to the appropriate typed validator.
 *
 * @method validateModule
 * @memberof ClientSchema.methods
 * @param {string} moduleName - Name of the config module (e.g. "login", "cors").
 * @param {Object} moduleConfig - Raw configuration object for that module.
 * @throws {Error} If the module configuration is invalid.
 */
clientSchema.methods.validateModule = function(moduleName, moduleConfig) {
    if ('enabled' in moduleConfig && typeof moduleConfig.enabled !== 'boolean') {
        throw new Error(`'enabled' field in ${moduleName} must be boolean`);
    }
    switch (moduleName) {
        case 'login':        this.validateLogin(moduleConfig);        break;
        case 'moderation':   this.validateModeration(moduleConfig);   break;
        case 'toxicity':     this.validateToxicity(moduleConfig);     break;
        case 'translation':  this.validateTranslation(moduleConfig);  break;
        case 'geolocation':  this.validateGeolocation(moduleConfig);  break;
        case 'cors':         this.validateCors(moduleConfig);         break;
        case 'entityConfig': this.validateEntityConfig(moduleConfig); break;
        case 'captcha':      this.validateCaptcha(moduleConfig);      break;
        case 'authWidget':   this.validateAuthWidget(moduleConfig);   break;
        case 'giphy':        this.validateGiphy(moduleConfig);        break;
    }
};

/**
 * Validates the `login` configuration block.
 *
 * @method validateLogin
 * @memberof ClientSchema.methods
 * @param {Object} loginConfig - Login configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateLogin = function(loginConfig) {
    if (loginConfig.baseUrl && !/^https?:\/\/.+\..+/.test(loginConfig.baseUrl)) {
        throw new Error('Base URL must be a valid URL');
    }
    if (loginConfig.jwtSecret && loginConfig.jwtSecret.length > 100) {
        throw new Error('JWT Secret cannot exceed 100 characters');
    }
    if (loginConfig.providers && !Array.isArray(loginConfig.providers)) {
        throw new Error('Providers must be an array');
    }
    if (loginConfig.providerDetails) {
        for (const [providerName, providerConfig] of Object.entries(loginConfig.providerDetails)) {
            if (providerConfig.clientId && providerConfig.clientId.length > 100) {
                throw new Error(`clientId for ${providerName} cannot exceed 100 characters`);
            }
            if (providerConfig.clientSecret && providerConfig.clientSecret.length > 100) {
                throw new Error(`clientSecret for ${providerName} cannot exceed 100 characters`);
            }
            if (providerConfig.clientSecretCipher && typeof providerConfig.clientSecretCipher !== 'string') {
                throw new Error(`clientSecretCipher for ${providerName} must be a string`);
            }
        }
    }
};

/**
 * Validates the `moderation` configuration block.
 *
 * @method validateModeration
 * @memberof ClientSchema.methods
 * @param {Object} moderationConfig - Moderation configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateModeration = function(moderationConfig) {
    if (moderationConfig.apiKey && moderationConfig.apiKey.length > 255) {
        throw new Error('Moderation API key cannot exceed 255 characters');
    }
    if (moderationConfig.apiKeyCipher && typeof moderationConfig.apiKeyCipher !== 'string') {
        throw new Error('apiKeyCipher must be a string');
    }
    if (moderationConfig.prompt && moderationConfig.prompt.length > 5000) {
        throw new Error('Moderation prompt cannot exceed 5000 characters');
    }
    if (moderationConfig.configJson && typeof moderationConfig.configJson !== 'object') {
        throw new Error('configJson must be an object');
    }
};

/**
 * Validates the `toxicity` configuration block, supporting legacy format and new provider details.
 *
 * @method validateToxicity
 * @memberof ClientSchema.methods
 * @param {Object} toxicityConfig - Toxicity configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateToxicity = function(toxicityConfig) {
    if (toxicityConfig.apiKey && toxicityConfig.apiKey.length > 255) {
        throw new Error('Toxicity API key cannot exceed 255 characters');
    }
    if (toxicityConfig.apiKeyCipher && typeof toxicityConfig.apiKeyCipher !== 'string') {
        throw new Error('apiKeyCipher must be a string');
    }
    if (toxicityConfig.threshold !== undefined && (typeof toxicityConfig.threshold !== 'number' || toxicityConfig.threshold < 0 || toxicityConfig.threshold > 1)) {
        throw new Error('Toxicity threshold must be a number between 0 and 1.');
    }
    if (toxicityConfig.configJson && typeof toxicityConfig.configJson !== 'object') {
        throw new Error('configJson must be an object');
    }
    
    if (toxicityConfig.thresholds !== undefined) {
        if (typeof toxicityConfig.thresholds !== 'object' || Array.isArray(toxicityConfig.thresholds) || toxicityConfig.thresholds === null) {
            throw new Error('Toxicity thresholds must be a valid object.');
        }
        const allowedMetrics = ['toxicity', 'severe_toxicity', 'obscene', 'threat', 'insult', 'identity_attack'];
        for (const [metric, value] of Object.entries(toxicityConfig.thresholds)) {
            if (!allowedMetrics.includes(metric)) {
                throw new Error(`Invalid toxicity threshold metric: ${metric}`);
            }
            if (typeof value !== 'number' || value < 0 || value > 1) {
                throw new Error(`Toxicity threshold for ${metric} must be a number between 0 and 1.`);
            }
        }
    }

    if (toxicityConfig.providerDetails) {
        if (typeof toxicityConfig.providerDetails !== 'object' || Array.isArray(toxicityConfig.providerDetails) || toxicityConfig.providerDetails === null) {
            throw new Error('providerDetails must be a valid object');
        }
        for (const [providerName, providerConfig] of Object.entries(toxicityConfig.providerDetails)) {
            if (providerConfig.apiKey && providerConfig.apiKey.length > 255) {
                throw new Error(`apiKey for ${providerName} cannot exceed 255 characters`);
            }
            if (providerConfig.apiKeyCipher && typeof providerConfig.apiKeyCipher !== 'string') {
                throw new Error(`apiKeyCipher for ${providerName} must be a string`);
            }
        }
    }
};

/**
 * Validates the `translation` configuration block.
 *
 * @method validateTranslation
 * @memberof ClientSchema.methods
 * @param {Object} translationConfig - Translation configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateTranslation = function(translationConfig) {
    if (translationConfig.apiKey && translationConfig.apiKey.length > 255) {
        throw new Error('Translation API key cannot exceed 255 characters');
    }
    if (translationConfig.apiKeyCipher && typeof translationConfig.apiKeyCipher !== 'string') {
        throw new Error('apiKeyCipher must be a string');
    }
    if (translationConfig.configJson && typeof translationConfig.configJson !== 'object') {
        throw new Error('configJson must be an object');
    }
};

/**
 * Validates the `geolocation` configuration block, covering both frontend and backend
 * provider sub-sections as well as MaxMind-specific options.
 *
 * @method validateGeolocation
 * @memberof ClientSchema.methods
 * @param {Object} geolocationConfig - Geolocation configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateGeolocation = function(geolocationConfig) {
    if (geolocationConfig.frontend) {
        if (geolocationConfig.frontend.apiKey && geolocationConfig.frontend.apiKey.length > 255) {
            throw new Error('Frontend Geolocation API key cannot exceed 255 characters');
        }
        if (geolocationConfig.frontend.apiKeyCipher && typeof geolocationConfig.frontend.apiKeyCipher !== 'string') {
            throw new Error('Frontend apiKeyCipher must be a string');
        }
    }

    if (geolocationConfig.backend) {
        if (geolocationConfig.backend.apiKey && geolocationConfig.backend.apiKey.length > 255) {
            throw new Error('Backend Geolocation API key cannot exceed 255 characters');
        }
        if (geolocationConfig.backend.apiKeyCipher && typeof geolocationConfig.backend.apiKeyCipher !== 'string') {
            throw new Error('Backend apiKeyCipher must be a string');
        }

        if (geolocationConfig.backend.provider === 'maxmind') {
            if (geolocationConfig.backend.dbPath && typeof geolocationConfig.backend.dbPath !== 'string') {
                throw new Error('dbPath must be a string');
            }
            if (geolocationConfig.backend.updateFrequency !== undefined) {
                const freq = geolocationConfig.backend.updateFrequency;
                if (typeof freq !== 'number' || !Number.isInteger(freq) || freq <= 0) {
                    throw new Error('updateFrequency must be an integer greater than 0');
                }
            }
            if (geolocationConfig.backend.enableCron !== undefined && typeof geolocationConfig.backend.enableCron !== 'boolean') {
                throw new Error('enableCron must be a boolean');
            }
        }
    }
};

/**
 * Validates the `cors` configuration block.
 *
 * @method validateCors
 * @memberof ClientSchema.methods
 * @param {Object} corsConfig - CORS configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateCors = function(corsConfig) {
    if ('allowedOrigins' in corsConfig && !Array.isArray(corsConfig.allowedOrigins)) {
        throw new Error('allowedOrigins must be an array');
    }
    if (corsConfig.enabled && (!corsConfig.allowedOrigins || corsConfig.allowedOrigins.length === 0)) {
        throw new Error('At least one allowed origin is required when CORS is enabled');
    }
    if (corsConfig.allowedOrigins) {
        if (corsConfig.allowedOrigins.length > 50) {
            throw new Error('Number of allowed origins cannot exceed 50');
        }
        for (const origin of corsConfig.allowedOrigins) {
            if (typeof origin !== 'string') {
                throw new Error('Each origin must be a string');
            }
            if (origin.length > 255) {
                throw new Error(`Origin ${origin} cannot exceed 255 characters`);
            }
            if (!/^(https?:\/\/)?(localhost|[\w-]+(\.[\w-]+)+|(\d{1,3}\.){3}\d{1,3}|\[[a-f0-9:]+\])(:\d+)?(\/.*)?$/i.test(origin)) {
                throw new Error(`Origin ${origin} is not a valid URL or IP address`);
            }
        }
    }
};

/**
 * Validates the `entityConfig` configuration block.
 *
 * @method validateEntityConfig
 * @memberof ClientSchema.methods
 * @param {Object} entityConfig - Entity configuration to validate.
 * @throws {Error} If any required field is missing or incorrectly typed.
 */
clientSchema.methods.validateEntityConfig = function(entityConfig) {
    if (!entityConfig.interactionPlacement || typeof entityConfig.interactionPlacement !== 'object' || Array.isArray(entityConfig.interactionPlacement) || entityConfig.interactionPlacement === null) {
        throw new Error('interactionPlacement must be a non-null object');
    }

    if (entityConfig.interactionPlacement.deterministic !== undefined && typeof entityConfig.interactionPlacement.deterministic !== 'boolean') {
        throw new Error('interactionPlacement.deterministic must be a boolean');
    }

    const isDeterministic = entityConfig.interactionPlacement.deterministic === true;

    if (!isDeterministic) {
        if (!entityConfig.selector || typeof entityConfig.selector !== 'string' || entityConfig.selector.length > 100) {
            throw new Error('selector must be a non-empty string with max length 100');
        }
        if (!entityConfig.entityIdAttribute || typeof entityConfig.entityIdAttribute !== 'string' || entityConfig.entityIdAttribute.length > 100) {
            throw new Error('entityIdAttribute must be a non-empty string with max length 100');
        }
        if (!entityConfig.interactionPlacement.position || !['before', 'after', 'inside'].includes(entityConfig.interactionPlacement.position)) {
            throw new Error('interactionPlacement.position must be either "before", "after", or "inside"');
        }
        if (entityConfig.interactionPlacement.relativeTo !== undefined && (typeof entityConfig.interactionPlacement.relativeTo !== 'string' || entityConfig.interactionPlacement.relativeTo.length > 100)) {
            throw new Error('interactionPlacement.relativeTo must be a string with max length 100');
        }
    }

    if (entityConfig.goTo !== undefined && typeof entityConfig.goTo !== 'boolean') {
        throw new Error('goTo must be a boolean');
    }
    if (entityConfig.hrefAttribute !== undefined && (typeof entityConfig.hrefAttribute !== 'string' || entityConfig.hrefAttribute.length > 100)) {
        throw new Error('hrefAttribute must be a string with max length 100');
    }
};

/**
 * Validates the `authWidget` configuration block.
 *
 * @method validateAuthWidget
 * @memberof ClientSchema.methods
 * @param {Object} authWidgetConfig - Auth widget configuration to validate.
 * @throws {Error} If any required field is missing or incorrectly typed.
 */
clientSchema.methods.validateAuthWidget = function(authWidgetConfig) {
    if (authWidgetConfig.enabled) {
        if (!authWidgetConfig.selector || typeof authWidgetConfig.selector !== 'string' || authWidgetConfig.selector.length > 100) {
            throw new Error('authWidget selector must be a non-empty string with max length 100 when enabled');
        }
        if (!authWidgetConfig.position || !['before', 'after', 'inside'].includes(authWidgetConfig.position)) {
            throw new Error('authWidget position must be either "before", "after", or "inside" when enabled');
        }
    } else {
        if (authWidgetConfig.selector !== undefined && typeof authWidgetConfig.selector !== 'string') {
            throw new Error('authWidget selector must be a string');
        }
        if (authWidgetConfig.position !== undefined && !['before', 'after', 'inside'].includes(authWidgetConfig.position)) {
            throw new Error('authWidget position must be either "before", "after", or "inside"');
        }
    }
};

/**
 * Validates the `captcha` configuration block.
 *
 * @method validateCaptcha
 * @memberof ClientSchema.methods
 * @param {Object} captchaConfig - Captcha configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateCaptcha = function(captchaConfig) {
    if ('enabled' in captchaConfig && typeof captchaConfig.enabled !== 'boolean') {
        throw new Error('captcha.enabled must be a boolean');
    }
    if ('provider' in captchaConfig && !['turnstile', 'recaptcha'].includes(captchaConfig.provider)) {
        throw new Error('captcha.provider must be either "turnstile" or "recaptcha"');
    }
    if (captchaConfig.enabled && (!captchaConfig.siteKey || typeof captchaConfig.siteKey !== 'string' || captchaConfig.siteKey.length > 250)) {
        throw new Error('captcha.siteKey must be a non-empty string with max length 250 when enabled');
    }
    if ('credentialsJson' in captchaConfig) {
        if (typeof captchaConfig.credentialsJson !== 'string') {
            throw new Error('captcha.credentialsJson must be a string');
        }
        if (captchaConfig.credentialsJson.length > 5000) {
            throw new Error('captcha.credentialsJson cannot exceed 5000 characters');
        }
        if (captchaConfig.credentialsJson && !this.isValidJson(captchaConfig.credentialsJson)) {
            throw new Error('captcha.credentialsJson must be a valid JSON string');
        }
    }
};

/**
 * Validates the `giphy` configuration block.
 *
 * All three fields are optional: when absent the proxy route falls back to
 * the `GIPHY_API_KEY`, `GIPHY_SEARCH_URL`, and `GIPHY_TRENDING_URL` environment
 * variables.  When present each field is validated for type and length to
 * prevent oversized values reaching the database.
 *
 * Accepted fields:
 * - `apiKey`      {string} Plain-text Giphy API key (max 255 chars).
 * Stored encrypted as `apiKeyCipher` by the pre-save hook.
 * - `apiKeyCipher`{string} Encrypted Giphy API key (written by pre-save hook, not by callers).
 * - `searchUrl`   {string} Override for the Giphy search endpoint (max 500 chars).
 * - `trendingUrl` {string} Override for the Giphy trending endpoint (max 500 chars).
 *
 * @method validateGiphy
 * @memberof ClientSchema.methods
 * @param {Object} giphyConfig - Giphy configuration to validate.
 * @throws {Error} If any field value is out of bounds or incorrectly typed.
 */
clientSchema.methods.validateGiphy = function(giphyConfig) {
    if (giphyConfig.apiKey !== undefined && giphyConfig.apiKey !== '') {
        if (typeof giphyConfig.apiKey !== 'string' || giphyConfig.apiKey.length > 255) {
            throw new Error('giphy.apiKey must be a string with max length 255');
        }
    }
    if (giphyConfig.apiKeyCipher !== undefined && typeof giphyConfig.apiKeyCipher !== 'string') {
        throw new Error('giphy.apiKeyCipher must be a string');
    }
    if (giphyConfig.searchUrl !== undefined && giphyConfig.searchUrl !== '') {
        if (typeof giphyConfig.searchUrl !== 'string' || giphyConfig.searchUrl.length > 500) {
            throw new Error('giphy.searchUrl must be a string with max length 500');
        }
        if (!/^https?:\/\/.+/.test(giphyConfig.searchUrl)) {
            throw new Error('giphy.searchUrl must be a valid HTTP/HTTPS URL');
        }
    }
    if (giphyConfig.trendingUrl !== undefined && giphyConfig.trendingUrl !== '') {
        if (typeof giphyConfig.trendingUrl !== 'string' || giphyConfig.trendingUrl.length > 500) {
            throw new Error('giphy.trendingUrl must be a string with max length 500');
        }
        if (!/^https?:\/\/.+/.test(giphyConfig.trendingUrl)) {
            throw new Error('giphy.trendingUrl must be a valid HTTP/HTTPS URL');
        }
    }
};

/**
 * Checks whether a given string is valid JSON.
 *
 * @method isValidJson
 * @memberof ClientSchema.methods
 * @param {string} jsonString - The string to test.
 * @returns {boolean} `true` if parseable as JSON, `false` otherwise.
 */
clientSchema.methods.isValidJson = function(jsonString) {
    try {
        JSON.parse(jsonString);
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Pre-validate hook: strips legacy config keys that were removed in previous
 * versions before validators run, so existing documents can be saved without errors.
 */
clientSchema.pre('validate', function(next) {
    if (this.config && ('modeDiscovery' in this.config || 'discoveryDataUrl' in this.config)) {
        delete this.config.modeDiscovery;
        delete this.config.discoveryDataUrl;
        this.markModified('config');
    }
    next();
});

/**
 * Pre-save hook that:
 * - Updates `updatedAt` on every write.
 * - Encrypts all sensitive plain-text fields before persistence.
 */
clientSchema.pre('save', function(next) {
    this.updatedAt = Date.now();

    if (this.isModified('config')) {
        const config = this.config;

        if (config.login?.providerDetails) {
            for (const provider of Object.values(config.login.providerDetails)) {
                if (provider.clientSecret && provider.clientSecret !== '') {
                    provider.clientSecretCipher = encrypt(provider.clientSecret, ENCRYPTION_KEY);
                    delete provider.clientSecret;
                }
            }
        }

        const modulesToEncrypt = ['moderation', 'translation'];
        for (const moduleName of modulesToEncrypt) {
            if (config[moduleName]?.apiKey && config[moduleName].apiKey !== '') {
                config[moduleName].apiKeyCipher = encrypt(config[moduleName].apiKey, ENCRYPTION_KEY);
                delete config[moduleName].apiKey;
            }
        }

        if (config.toxicity) {
            if (config.toxicity.apiKey && config.toxicity.apiKey !== '') {
                config.toxicity.apiKeyCipher = encrypt(config.toxicity.apiKey, ENCRYPTION_KEY);
                delete config.toxicity.apiKey;
            }
            if (config.toxicity.providerDetails) {
                for (const provider of Object.values(config.toxicity.providerDetails)) {
                    if (provider.apiKey && provider.apiKey !== '') {
                        provider.apiKeyCipher = encrypt(provider.apiKey, ENCRYPTION_KEY);
                        delete provider.apiKey;
                    }
                }
            }
        }

        if (config.geolocation) {
            if (config.geolocation.frontend?.apiKey && config.geolocation.frontend.apiKey !== '') {
                config.geolocation.frontend.apiKeyCipher = encrypt(config.geolocation.frontend.apiKey, ENCRYPTION_KEY);
                delete config.geolocation.frontend.apiKey;
            }
            if (config.geolocation.backend?.apiKey && config.geolocation.backend.apiKey !== '') {
                config.geolocation.backend.apiKeyCipher = encrypt(config.geolocation.backend.apiKey, ENCRYPTION_KEY);
                delete config.geolocation.backend.apiKey;
            }
        }

        if (config.login?.jwtSecret) {
            config.login.jwtSecretCipher = encrypt(config.login.jwtSecret, ENCRYPTION_KEY);
            delete config.login.jwtSecret;
        }
        if (config.captcha?.secretKey) {
            config.captcha.secretKeyCipher = encrypt(config.captcha.secretKey, ENCRYPTION_KEY);
            delete config.captcha.secretKey;
        }
        if (config.captcha?.credentialsJson) {
            config.captcha.credentialsJsonCipher = encrypt(config.captcha.credentialsJson, ENCRYPTION_KEY);
            delete config.captcha.credentialsJson;
        }

        if (config.giphy?.apiKey && config.giphy.apiKey !== '') {
            config.giphy.apiKeyCipher = encrypt(config.giphy.apiKey, ENCRYPTION_KEY);
            delete config.giphy.apiKey;
        }

        this.markModified('config');
    }

    if (this.isModified('email') && this.email?.smtp_pass) {
        this.email.smtp_passCipher = encrypt(this.email.smtp_pass, ENCRYPTION_KEY);
        delete this.email.smtp_pass;
        this.markModified('email');
    }

    if (this.isModified('vapid') && this.vapid?.privateKey) {
        this.vapid.privateKeyCipher = encrypt(this.vapid.privateKey, ENCRYPTION_KEY);
        delete this.vapid.privateKey;
        this.markModified('vapid');
    }

    if (this.isModified('resilience') && this.resilience?.privateKey) {
        this.resilience.privateKeyCipher = encrypt(this.resilience.privateKey, ENCRYPTION_KEY);
        delete this.resilience.privateKey;
        this.markModified('resilience');
    }

    if (this.isModified('turn') && this.turn?.staticAuthSecret && this.turn.staticAuthSecret !== '') {
        this.turn.staticAuthSecretCipher = encrypt(this.turn.staticAuthSecret, ENCRYPTION_KEY);
        delete this.turn.staticAuthSecret;
        this.markModified('turn');
    }

    if (this.isModified('nostr') && this.nostr?.authSecret && this.nostr.authSecret !== '') {
        this.nostr.authSecretCipher = encrypt(this.nostr.authSecret, ENCRYPTION_KEY);
        delete this.nostr.authSecret;
        this.markModified('nostr');
    }

    next();
});

// --- DEFENSE LINE 2: AUTOMATIC INVALIDATION ---
// Ensures that any write to the DB invalidates the cache layer immediately.

clientSchema.post('save', async function(doc) {
    if (doc && doc.cid) {
        await invalidateClientCache(doc.cid);
    }
});

clientSchema.post(/^findOneAnd/, async function(doc) {
    if (doc && doc.cid) {
        await invalidateClientCache(doc.cid);
    }
});

clientSchema.post('remove', async function(doc) {
    if (doc && doc.cid) {
        await invalidateClientCache(doc.cid);
    }
});

clientSchema.path('config').validate({
    validator: function(config) {
        const configKeys = Object.keys(config);
        const invalidKeys = configKeys.filter(key => !allowedConfigKeys.includes(key));
        if (invalidKeys.length > 0) {
            throw new Error(`Invalid config keys: ${invalidKeys.join(', ')}`);
        }
        for (const [moduleName, moduleConfig] of Object.entries(config)) {
            if (typeof moduleConfig !== 'object' || Array.isArray(moduleConfig) || moduleConfig === null) {
                throw new Error(`Configuration for '${moduleName}' must be an object`);
            }
            this.validateModule(moduleName, moduleConfig);
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid configuration'
});

clientSchema.path('postConfig').validate({
    validator: async function(postConfig) {
        try {
            const defaultConfig = Post.getDefaultConfig();
            const postConfigKeys = Object.keys(postConfig);
            const invalidKeys = postConfigKeys.filter(key => !Object.keys(defaultConfig).includes(key));
            if (invalidKeys.length > 0) {
                throw new Error(`Invalid postConfig keys: ${invalidKeys.join(', ')}`);
            }
            for (const [key, value] of Object.entries(postConfig)) {
                const defaultValue = defaultConfig[key];
                if (key === 'visibility') {
                    if (typeof value !== 'string' || !['public', 'private', 'followers'].includes(value)) {
                        throw new Error(`Invalid value for visibility: ${value}`);
                    }
                } else if (key === 'category') {
                    if (typeof value !== 'string' || value.length > 50) {
                        throw new Error(`Category must be a string with max length 50`);
                    }
                } else if (key === 'tags') {
                    if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string' || tag.length > 30)) {
                        throw new Error(`Tags must be an array of strings with max length 30`);
                    }
                    if (value.length > 10) {
                        throw new Error(`Maximum 10 tags allowed`);
                    }
                } else if (typeof defaultValue === 'string') {
                    if (typeof value !== 'string') {
                        throw new Error(`'${key}' must be a string`);
                    }
                } else if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
                        throw new Error(`Configuration for '${key}' must be an object`);
                    }
                    for (const [subKey, subValue] of Object.entries(value)) {
                        if (!(subKey in defaultValue)) {
                            throw new Error(`Invalid sub-key in ${key}: ${subKey}`);
                        }
                        const defaultSubValue = defaultValue[subKey];
                        if (typeof defaultSubValue === 'boolean' && typeof subValue !== 'boolean') {
                            throw new Error(`'${subKey}' in ${key} must be a boolean`);
                        } else if (typeof defaultSubValue === 'number' && (typeof subValue !== 'number' || subValue < 0)) {
                            throw new Error(`'${subKey}' in ${key} must be a non-negative number`);
                        } else if (typeof defaultSubValue === 'string') {
                            if (subKey === 'post_language' && (typeof subValue !== 'string' || subValue.length > 10)) {
                                throw new Error(`'post_language' must be a string with max length 10`);
                            }
                            if (subKey === 'moderation_prompt' && (typeof subValue !== 'string' || subValue.length > 200)) {
                                throw new Error(`'moderation_prompt' must be a string with max length 200`);
                            }
                            if ((subKey === 'scheduled_time' || subKey === 'expire_at') && (typeof subValue !== 'string' || isNaN(Date.parse(subValue)))) {
                                throw new Error(`'${subKey}' must be a valid date string`);
                            }
                        } else if (subKey === 'banned_words') {
                            if (!Array.isArray(subValue) || subValue.some(word => typeof word !== 'string' || word.length > 50)) {
                                throw new Error(`Banned words must be an array of strings with max length 50`);
                            }
                        }
                    }
                } else {
                    throw new Error(`Unexpected configuration type for '${key}'`);
                }
            }
            return true;
        } catch (error) {
            console.error('Validation error:', error.message);
            throw error;
        }
    },
    message: props => props.reason.message || 'Invalid postConfig configuration'
});

clientSchema.path('vapid').validate({
    validator: function(vapid) {
        if (vapid.publicKey !== undefined && vapid.publicKey !== "") {
            if (typeof vapid.publicKey !== 'string' || vapid.publicKey.length > 88) {
                throw new Error('publicKey must be a string up to 88 characters');
            }
        }
        if (vapid.privateKey !== undefined && vapid.privateKey !== "") {
            if (typeof vapid.privateKey !== 'string' || vapid.privateKey.length > 44) {
                throw new Error('privateKey must be a string up to 44 characters');
            }
        }
        if (vapid.email !== undefined && vapid.email !== "") {
            if (typeof vapid.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vapid.email) || vapid.email.length > 254) {
                throw new Error('email must be a valid email address with max length 254');
            }
        }
        if (vapid.iconBase64 !== undefined && vapid.iconBase64 !== "") {
            if (typeof vapid.iconBase64 !== 'string') {
                throw new Error('iconBase64 must be a string');
            }
            if (vapid.iconBase64.length > 0) {
                try {
                    const buffer = Buffer.from(vapid.iconBase64, 'base64');
                    if (buffer.length > 100 * 1024) {
                        throw new Error('iconBase64 size must not exceed 100KB');
                    }
                } catch (error) {
                    throw new Error('Invalid base64 string for iconBase64');
                }
            }
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid VAPID configuration'
});

clientSchema.path('email').validate({
    validator: function(email) {
        if (email.requires_auth !== undefined && typeof email.requires_auth !== 'boolean') {
            throw new Error('requires_auth must be a boolean');
        }

        if (email.smtp_host !== undefined && email.smtp_host !== "") {
            if (typeof email.smtp_host !== 'string' || email.smtp_host.length < 3 || email.smtp_host.length > 100) {
                throw new Error('smtp_host must be a string between 3 and 100 characters');
            }
        }
        if (email.smtp_port !== undefined && email.smtp_port !== "") {
            const portNum = parseInt(email.smtp_port);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                throw new Error('smtp_port must be a valid number between 1 and 65535');
            }
        }

        if (email.requires_auth !== false) {
            if (email.smtp_user !== undefined && email.smtp_user !== "") {
                if (typeof email.smtp_user !== 'string' || email.smtp_user.length < 3 || email.smtp_user.length > 100) {
                    throw new Error('smtp_user must be a string between 3 and 100 characters');
                }
            }
            if (email.smtp_pass !== undefined && email.smtp_pass !== "") {
                if (typeof email.smtp_pass !== 'string' || email.smtp_pass.length < 6 || email.smtp_pass.length > 100) {
                    throw new Error('smtp_pass must be a string between 6 and 100 characters');
                }
            }
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid email configuration'
});

clientSchema.path('resilience').validate({
    validator: function(res) {
        if (res.enabled !== undefined && typeof res.enabled !== 'boolean') {
            throw new Error('resilience.enabled must be a boolean');
        }
        if (res.enabled) {
            if (!res.keyId || typeof res.keyId !== 'string') {
                throw new Error('keyId is required when resilience is enabled');
            }
            if (!res.publicKey || typeof res.publicKey !== 'string') {
                throw new Error('publicKey is required when resilience is enabled');
            }
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid resilience configuration'
});

clientSchema.path('turn').validate({
    validator: function(turn) {
        if (turn.server !== undefined && turn.server !== '') {
            if (typeof turn.server !== 'string' || turn.server.length < 1 || turn.server.length > 253) {
                throw new Error('turn.server must be a string between 1 and 253 characters');
            }
        }

        if (turn.port !== undefined && turn.port !== '') {
            const portNum = parseInt(turn.port, 10);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                throw new Error('turn.port must be a valid integer between 1 and 65535');
            }
        }

        if (turn.protocol !== undefined && turn.protocol !== '') {
            if (!['udp', 'tcp', 'tls'].includes(turn.protocol)) {
                throw new Error('turn.protocol must be one of "udp", "tcp", or "tls"');
            }
        }

        if (turn.transport !== undefined && turn.transport !== '') {
            if (!['all', 'relay'].includes(turn.transport)) {
                throw new Error('turn.transport must be either "all" or "relay"');
            }
        }

        if (turn.realm !== undefined && turn.realm !== '') {
            if (typeof turn.realm !== 'string' || turn.realm.length < 1 || turn.realm.length > 253) {
                throw new Error('turn.realm must be a string between 1 and 253 characters');
            }
        }

        if (turn.ttl !== undefined && turn.ttl !== '') {
            const ttl = parseInt(turn.ttl, 10);
            if (isNaN(ttl) || !Number.isInteger(ttl) || ttl <= 0) {
                throw new Error('turn.ttl must be a positive integer (seconds)');
            }
        }

        if (turn.staticAuthSecret !== undefined && turn.staticAuthSecret !== '') {
            if (typeof turn.staticAuthSecret !== 'string' || turn.staticAuthSecret.length > 255) {
                throw new Error('turn.staticAuthSecret must be a string up to 255 characters');
            }
        }

        if (turn.staticAuthSecretCipher !== undefined && typeof turn.staticAuthSecretCipher !== 'string') {
            throw new Error('turn.staticAuthSecretCipher must be a string');
        }

        return true;
    },
    message: props => props.reason.message || 'Invalid TURN configuration'
});

clientSchema.path('nostr').validate({
    validator: function(nostr) {
        if (nostr.authSecret !== undefined && nostr.authSecret !== '') {
            if (typeof nostr.authSecret !== 'string' || nostr.authSecret.length > 255) {
                throw new Error('nostr.authSecret must be a string up to 255 characters');
            }
        }
        if (nostr.authSecretCipher !== undefined && typeof nostr.authSecretCipher !== 'string') {
            throw new Error('nostr.authSecretCipher must be a string');
        }
        if (nostr.url !== undefined && nostr.url !== '') {
            if (typeof nostr.url !== 'string' || nostr.url.length > 255) {
                throw new Error('nostr.url must be a string up to 255 characters');
            }
        }
        if (nostr.relays !== undefined) {
            if (!Array.isArray(nostr.relays)) {
                throw new Error('nostr.relays must be an array of strings');
            }
            if (nostr.relays.some(r => typeof r !== 'string')) {
                throw new Error('nostr.relays must contain only strings');
            }
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid Nostr configuration'
});

clientSchema.path('p2p').validate({
    validator: function(p2p) {
        if (p2p.trackerUrls !== undefined) {
            if (!Array.isArray(p2p.trackerUrls)) {
                throw new Error('p2p.trackerUrls must be an array of strings');
            }
            if (p2p.trackerUrls.some(t => typeof t !== 'string')) {
                throw new Error('p2p.trackerUrls must contain only strings');
            }
        }
        if (p2p.rtcServers !== undefined) {
            if (!Array.isArray(p2p.rtcServers)) {
                throw new Error('p2p.rtcServers must be an array of strings');
            }
            if (p2p.rtcServers.some(r => typeof r !== 'string')) {
                throw new Error('p2p.rtcServers must contain only strings');
            }
        }
        return true;
    },
    message: props => props.reason.message || 'Invalid P2P configuration'
});

module.exports = mongoose.model('Client', clientSchema);