/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/clientConfigService.js */
const { cacheService } = require('./cacheService');
const Client = require('../models/Client');
const { buildPluginManifest } = require('../utils/pluginRegistry');

const BASE_KEY = 'client:config';
const CACHE_TTL = 3600; // 1 hour

/**
 * Centralized cache key definitions.
 * Exported to ensure consistency with Model hooks.
 *
 * @type {Object.<string, function(string): string>}
 */
const KEYS = {
    FULL:       (cid) => `${BASE_KEY}:${cid}:full`,
    CONFIG:     (cid) => `${BASE_KEY}:${cid}`,
    POST:       (cid) => `${BASE_KEY}:${cid}:post`,
    VAPID:      (cid) => `${BASE_KEY}:${cid}:vapid`,
    EMAIL:      (cid) => `${BASE_KEY}:${cid}:email`,
    TURN:       (cid) => `${BASE_KEY}:${cid}:turn`,
    NOSTR:      (cid) => `${BASE_KEY}:${cid}:nostr`,
    P2P:        (cid) => `${BASE_KEY}:${cid}:p2p`,
    RESILIENCE: (cid) => `${BASE_KEY}:${cid}:resilience`,
    GIPHY:      (cid) => `${BASE_KEY}:${cid}:giphy`,
    WIDGET:     (cid) => `${BASE_KEY}:${cid}:widget`,
    MODULES:    (cid) => `${BASE_KEY}:${cid}:modules`,
};

/**
 * Retrieves the full Client document from Cache (Redis) or Database (Mongo).
 * Acts as the "Master" source of truth to prevent read amplification.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} The full client object (lean) or null.
 */
async function getClientCached(cid) {
    if (!cid) return null;
    const cacheKey = KEYS.FULL(cid);

    try {
        let clientData = await cacheService.get(cacheKey);

        if (!clientData) {
            const client = await Client.findOne({ cid }).lean();
            if (!client) return null;

            clientData = client;
            await cacheService.set(cacheKey, clientData, CACHE_TTL);
        }

        return clientData;
    } catch (error) {
        console.error(`[Cache] Error fetching client full for CID ${cid}:`, error);
        return await Client.findOne({ cid }).lean();
    }
}

/**
 * Retrieves the decrypted main configuration.
 * Uses getClientCached to avoid extra DB hits, then caches the decrypted result.
 *
 * @param {string} cid    - The Client ID.
 * @param {string} [path] - Optional dot-notation path to retrieve a specific value.
 * @returns {Promise<Object|any|null>} The config object or specific value.
 */
async function getClientConfig(cid, path = '') {
    try {
        const configKey = KEYS.CONFIG(cid);
        let config = await cacheService.get(configKey);

        if (!config) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            config = doc.decryptConf();
            await cacheService.set(configKey, config, CACHE_TTL);
        }

        if (!path) return config;
        return getValueByPath(config, path);
    } catch (error) {
        console.error(`Error getting client config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves the Post configuration.
 *
 * @param {string} cid    - The Client ID.
 * @param {string} [path] - Optional dot-notation path.
 * @returns {Promise<Object|any|null>} Post config.
 */
async function getClientPostConfig(cid, path = '') {
    try {
        const postKey = KEYS.POST(cid);
        let postConfig = await cacheService.get(postKey);

        if (!postConfig) {
            const client = await getClientCached(cid);
            if (!client || !client.postConfig) return null;

            postConfig = client.postConfig;
            await cacheService.set(postKey, postConfig, CACHE_TTL);
        }

        if (!path) return postConfig;
        return getValueByPath(postConfig, path);
    } catch (error) {
        console.error(`Error getting post config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves decrypted VAPID keys.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} VAPID config.
 */
async function getClientVapidConfig(cid) {
    try {
        const vapidKey = KEYS.VAPID(cid);
        let vapid = await cacheService.get(vapidKey);

        if (!vapid) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            vapid = doc.decryptVapid();
            await cacheService.set(vapidKey, vapid, CACHE_TTL);
        }
        return vapid;
    } catch (error) {
        console.error(`Error getting VAPID config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves decrypted Email configuration.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} Email config.
 */
async function getClientEmailConfig(cid) {
    try {
        const emailKey = KEYS.EMAIL(cid);
        let email = await cacheService.get(emailKey);

        if (!email) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            email = doc.decryptEmail();
            await cacheService.set(emailKey, email, CACHE_TTL);
        }
        return email;
    } catch (error) {
        console.error(`Error getting EMAIL config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves decrypted TURN configuration.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} TURN config.
 */
async function getClientTurnConfig(cid) {
    try {
        const turnKey = KEYS.TURN(cid);
        let turn = await cacheService.get(turnKey);

        if (!turn) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            turn = doc.decryptTurn();
            await cacheService.set(turnKey, turn, CACHE_TTL);
        }
        return turn;
    } catch (error) {
        console.error(`Error getting TURN config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves decrypted Nostr configuration.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} Nostr config.
 */
async function getClientNostrConfig(cid) {
    try {
        const nostrKey = KEYS.NOSTR(cid);
        let nostr = await cacheService.get(nostrKey);

        if (!nostr) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            nostr = doc.decryptNostr();
            await cacheService.set(nostrKey, nostr, CACHE_TTL);
        }
        return nostr;
    } catch (error) {
        console.error(`Error getting Nostr config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves P2P configuration.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} P2P config.
 */
async function getClientP2pConfig(cid) {
    try {
        const p2pKey = KEYS.P2P(cid);
        let p2p = await cacheService.get(p2pKey);

        if (!p2p) {
            const client = await getClientCached(cid);
            if (!client || !client.p2p) return null;

            p2p = client.p2p;
            await cacheService.set(p2pKey, p2p, CACHE_TTL);
        }
        return p2p;
    } catch (error) {
        console.error(`Error getting P2P config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves the public resilience configuration (no private key material).
 * Private key fields are stripped before caching so they are never accessible
 * through the service layer.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} Public resilience config.
 */
async function getClientResilienceConfig(cid) {
    try {
        const resilienceKey = KEYS.RESILIENCE(cid);
        let resilience = await cacheService.get(resilienceKey);

        if (!resilience) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const raw = client.resilience || {};
            const { privateKeyCipher, privateKey, ...safe } = raw;
            resilience = safe;
            await cacheService.set(resilienceKey, resilience, CACHE_TTL);
        }
        return resilience;
    } catch (error) {
        console.error(`Error getting resilience config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Retrieves the decrypted Giphy configuration for a given client.
 *
 * The returned object contains:
 * - `apiKey`      {string|undefined} — decrypted Giphy API key, present only when
 *                  the client has configured one (stored as `apiKeyCipher` in the DB).
 * - `searchUrl`   {string|undefined} — client-level override for the Giphy search
 *                  endpoint.  Absent when not configured.
 * - `trendingUrl` {string|undefined} — client-level override for the Giphy trending
 *                  endpoint.  Absent when not configured.
 *
 * The proxy route (`giphyRoutes.js`) resolves credentials with the following priority:
 * 1. Client-level values returned by this function.
 * 2. Environment variables (`GIPHY_API_KEY`, `GIPHY_SEARCH_URL`, `GIPHY_TRENDING_URL`).
 *
 * The decrypted `apiKey` is cached under `KEYS.GIPHY(cid)` for the standard TTL
 * (1 hour). Cache is invalidated automatically by the `post('save')` hook in
 * `Client.js` whenever the client document changes.
 *
 * Returns `null` when the client does not exist or has no `giphy` block configured.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<{ apiKey?: string, searchUrl?: string, trendingUrl?: string }|null>}
 */
async function getClientGiphyConfig(cid) {
    try {
        const giphyKey = KEYS.GIPHY(cid);
        let giphy = await cacheService.get(giphyKey);

        if (!giphy) {
            const client = await getClientCached(cid);
            if (!client) return null;

            const doc = new Client(client);
            const decryptedConf = doc.decryptConf();
            const raw = decryptedConf.giphy;

            if (!raw) return null;

            giphy = {
                ...(raw.apiKey      && { apiKey:      raw.apiKey }),
                ...(raw.searchUrl   && { searchUrl:   raw.searchUrl }),
                ...(raw.trendingUrl && { trendingUrl: raw.trendingUrl }),
            };

            await cacheService.set(giphyKey, giphy, CACHE_TTL);
        }

        return giphy;
    } catch (error) {
        console.error(`Error getting Giphy config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Utility to retrieve nested object values via dot-notation string.
 *
 * @param {Object} obj  - The object to traverse.
 * @param {string} path - The dot-notation path.
 * @returns {any|null} The resolved value or null.
 */
function getValueByPath(obj, path) {
    if (!obj) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current[part] === undefined) return null;
        current = current[part];
    }
    return current;
}

/**
 * Builds a sanitized `providerDetails` object safe for public widget consumption.
 *
 * Only the fields required by the widget's SSO SDK initialisation are included
 * (`clientId` for all providers; `appId` for Facebook, which is the key name
 * expected by the Facebook JS SDK and read by `SessionModule` via
 * `ConfModule.get('login.providerDetails.Facebook.appId')`).
 * All server-side secrets (`clientSecret`, `clientSecretCipher`, and any other
 * fields not in the explicit allow-list) are excluded regardless of what
 * `decryptConf()` produced.
 *
 * Facebook normalisation: the stored value may be keyed as either `clientId` or
 * `appId`. Both are mapped to `appId` so the widget always finds the value under
 * the key it requests.
 *
 * @param {Object|undefined} providerDetails - The `login.providerDetails` object
 *   from the decrypted client configuration.
 * @returns {Object} A plain object keyed by provider name, each value containing
 *   only the public fields needed by the widget. Empty object when the input is
 *   absent or not a plain object.
 */
function buildPublicProviderDetails(providerDetails) {
    if (!providerDetails || typeof providerDetails !== 'object') return {};

    const result = {};

    for (const [provider, details] of Object.entries(providerDetails)) {
        if (!details || typeof details !== 'object') continue;

        if (provider === 'Facebook') {
            const appId = details.appId ?? details.clientId;
            if (appId !== undefined) {
                result[provider] = { appId };
            }
        } else {
            if (details.clientId !== undefined) {
                result[provider] = { clientId: details.clientId };
            }
        }
    }

    return result;
}

/**
 * Assembles and caches the public widget configuration for a given client.
 *
 * Returns a safe whitelist of fields the widget needs to bootstrap. Sensitive
 * server-side values (JWT secrets, OAuth client secrets, backend API keys,
 * SMTP credentials, private keys) are never included.
 *
 * Geolocation is normalised to a flat { enabled, provider, apiKey } object
 * matching the shape expected by ConfModule in the widget, regardless of
 * whether the stored config uses the nested frontend/backend structure or the
 * flat legacy structure.
 *
 * The `login.providerDetails` field is included as a sanitized map of provider
 * names to their public-facing client identifiers only. This allows the widget's
 * `SessionModule` to initialise each SSO SDK (Google, Facebook, Apple, X) with
 * the correct `clientId` / `appId` without any server-side secret being exposed.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object|null>} The public widget config, or null if the client does not exist.
 */
async function getClientWidgetConfig(cid) {
    try {
        const widgetKey = KEYS.WIDGET(cid);
        const cached    = await cacheService.get(widgetKey);
        if (cached) return cached;

        const client = await getClientCached(cid);
        if (!client) return null;

        const doc  = new Client(client);
        const conf = doc.decryptConf();

        const geo      = conf.geolocation || {};
        const geoFront = geo.frontend || {};
        const geolocation = {
            enabled:  geoFront.enabled  ?? geo.enabled  ?? false,
            provider: geoFront.provider ?? geo.provider ?? 'none',
            apiKey:   geoFront.apiKey   ?? geo.apiKey   ?? '',
        };

        const { features: moduleFeatures, plugins } = buildPluginManifest(
            client.enterpriseModules ?? [],
            client.communityPlugins  ?? []
        );

        const widgetConfig = {
            login: {
                queloraSession:  conf.login?.queloraSession ?? true,
                providers:       conf.login?.providers      ?? [],
                baseUrl:         conf.login?.baseUrl        ?? '',
                loginUrl:        conf.login?.loginUrl       ?? '',
                logoutUrl:       conf.login?.logoutUrl      ?? '',
                providerDetails: buildPublicProviderDetails(conf.login?.providerDetails),
            },
            captcha: {
                enabled:  conf.captcha?.enabled  ?? false,
                provider: conf.captcha?.provider ?? '',
                siteKey:  conf.captcha?.siteKey  ?? '',
            },
            geolocation,
            authWidget:   conf.authWidget   ?? {},
            language:     conf.language     ?? {},
            entityConfig: conf.entityConfig ?? {},
            features:     moduleFeatures,
            audio:        conf.audio        ?? {},
            comments:     conf.comments     ?? {},
            vapid: {
                publicKey: client.vapid?.publicKey ?? null,
            },
            nostr: {
                relays: client.nostr?.relays ?? [],
            },
            plugins,
            ...(client.p2p?.trackerUrls && { trackerUrls: client.p2p.trackerUrls }),
        };

        await cacheService.set(widgetKey, widgetConfig, CACHE_TTL);
        return widgetConfig;
    } catch (error) {
        console.error(`Error getting widget config for CID ${cid}:`, error);
        return null;
    }
}

/**
 * Invalidates ALL cache keys associated with a specific CID.
 * Must be called whenever the Client document is updated.
 *
 * @param {string} cid - The Client ID.
 * @returns {Promise<void>}
 */
async function clearClientConfigCache(cid) {
    if (!cid) return;
    const keysToDelete = [
        KEYS.FULL(cid),
        KEYS.CONFIG(cid),
        KEYS.POST(cid),
        KEYS.VAPID(cid),
        KEYS.EMAIL(cid),
        KEYS.TURN(cid),
        KEYS.NOSTR(cid),
        KEYS.P2P(cid),
        KEYS.RESILIENCE(cid),
        KEYS.GIPHY(cid),
        KEYS.WIDGET(cid),
        KEYS.MODULES(cid),
    ];

    try {
        await Promise.all(keysToDelete.map(key => cacheService.delete(key)));
    } catch (error) {
        console.error(`Error clearing client cache for ${cid}:`, error);
    }
}

module.exports = {
    getClientCached,
    getClientConfig,
    getClientPostConfig,
    getClientVapidConfig,
    getClientEmailConfig,
    getClientTurnConfig,
    getClientNostrConfig,
    getClientP2pConfig,
    getClientResilienceConfig,
    getClientGiphyConfig,
    getClientWidgetConfig,
    clearClientConfigCache,
    KEYS,
};