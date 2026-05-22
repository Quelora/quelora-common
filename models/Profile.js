/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/models/Profile.js */
const { mongoose } = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const ngeohash = require('ngeohash');

const { cacheClient } = require('../services/cacheService');
const { getClientCached } = require('../services/clientConfigService');
const { generateOnboardingSuggestions } = require('../services/onboardingService');

require('./ProfileBookmark');
require('./ProfileComment');
require('./ProfileFollower');
require('./ProfileFollowing');
require('./ProfileLike');
require('./ProfileShare');

/**
 * Invalidates the versioned cache entries for a given profile directly from
 * the Model layer, without depending on profileService to avoid circular
 * imports. Mirrors the logic in `profileService.invalidateProfileCache`.
 *
 * Strategy:
 *  - Bumps the version counter (JSON cache key invalidation).
 *  - Deletes the binary artifact key (P2P resilience cache).
 *
 * Both operations are executed atomically via `Promise.all`. Cache errors are
 * swallowed and logged so they never surface as HTTP errors.
 *
 * @param {string} cid    - Tenant/client identifier.
 * @param {string} author - Profile author hash.
 * @returns {Promise<void>}
 */
const invalidateCacheVersion = async (cid, author) => {
    if (!cid || !author) return;
    try {
        const versionKey = `profile:${cid}:${author}:v`;
        const binaryKey  = `cid:${cid}:profile:${author}:binary`;

        if (cacheClient) {
            await Promise.all([
                cacheClient.incr(versionKey),
                cacheClient.del(binaryKey),
            ]);
        }
    } catch (err) {
        console.error(`[ProfileModel] Cache invalidation failed for ${author}:`, err.message);
    }
};

/**
 * Factory that produces a keyset-paginated fetch function for profile
 * interaction sub-collections (likes, comments, shares, bookmarks,
 * followers, following).
 *
 * Pagination strategy: cursor on `created_at` using `$lt` against the
 * last fetched document. Callers in the service layer use an `_id`-based
 * cursor instead (see `processLikes`, `processComments`, etc.) — this
 * factory is used exclusively by the static methods exposed directly on
 * the Profile model.
 *
 * @param {string}   modelName            - Mongoose model name to query.
 * @param {string}   profileField         - Field name referencing the profile_id.
 * @param {string}   lastIdField          - Field name used as the pagination cursor.
 * @param {Array}    [populateOptions=[]] - Array of populate config objects.
 * @param {number}   [limit=50]           - Maximum documents per page.
 * @returns {Function} Async paginator `(profile_id, lastId) => Promise<Document[]>`.
 */
const paginationFactory = (modelName, profileField, lastIdField, populateOptions = [], limit = 50) => {
    return async function(profile_id, lastId) {
        const InteractionModel = mongoose.model(modelName);
        const query = { [profileField]: profile_id };
        const sort  = { created_at: -1 };

        if (lastId) {
            const lastDocument = await InteractionModel.findById(lastId);
            if (!lastDocument) {
                throw new Error(`${modelName.replace('Profile', '')} no encontrado`);
            }
            query.created_at = { $lt: lastDocument.created_at };
        }

        let findQuery = InteractionModel.find(query);

        if (populateOptions.length > 0) {
            populateOptions.forEach(option => {
                findQuery = findQuery.populate(option);
            });
        }

        return await findQuery.sort(sort).limit(limit);
    };
};

const GeoHistorySchema = new mongoose.Schema({
    location: {
        type: {
            type: String,
            enum: ['Point'],
            required: true,
        },
        coordinates: {
            type: [Number],
            required: true,
            validate: {
                validator: function(v) {
                    return v.length === 2 && v.every(n => typeof n === 'number');
                },
                message: props => `${props.value} is not a valid coordinates array`,
            },
        },
    },
    geohash: {
        type: String,
        required: true,
    },
    countryCode: {
        type: String,
        trim: true,
        maxlength: 2,
    },
    regionCode: {
        type: String,
        trim: true,
        maxlength: 6,
    },
    city: {
        type: String,
        trim: true,
        maxlength: 50,
    },
    source: {
        type: String,
        enum: ['manual', 'geocoding', 'ip', 'gps', null],
        default: null,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
});

const profileSchema = new mongoose.Schema({
    cid: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    author: {
        type: String,
    },
    name: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^[a-zA-Z0-9]{3,15}$/.test(v);
            },
            message: props =>
                `${props.value} is not a valid name. Must contain only letters and numbers, and be between 3-15 characters long.`,
        },
    },
    given_name: {
        type: String,
    },
    family_name: {
        type: String,
        required: false,
    },
    email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: props => `${props.value} is not a valid email`,
        },
    },
    password: {
        type: String,
        required: false,
        minlength: [8, 'Password must be at least 8 characters long'],
    },
    picture: {
        type: String,
        required: false,
    },
    background: {
        type: String,
        required: false,
    },
    locale: {
        type: String,
    },
    bookmarksCount: {
        type: Number,
        default: 0,
    },
    commentsCount: {
        type: Number,
        default: 0,
    },
    followersCount: {
        type: Number,
        default: 0,
    },
    followingCount: {
        type: Number,
        default: 0,
    },
    blockedCount: {
        type: Number,
        default: 0,
    },
    likesCount: {
        type: Number,
        default: 0,
    },
    sharesCount: {
        type: Number,
        default: 0,
    },
    isBanned: {
        type: Boolean,
        default: false,
        index: true,
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
    lastActivityDate: {
        type: Date,
        default: Date.now,
        index: true,
    },
    trust: {
        score: { type: Number, default: 0, index: true },
        level: { type: Number, default: 1, min: 0, max: 5 },
        last_calc: { type: Date, default: Date.now },
    },
    pushSubscriptions: [{
        subscriptionId: {
            type: String,
            required: true,
            index: true,
        },
        platform: {
            type: String,
            enum: ['web', 'android', 'ios', 'other'],
            required: true,
        },
        permissionGranted: {
            type: Boolean,
            default: true,
        },
        endpoint: {
            type: String,
            required: true,
        },
        keys: {
            p256dh: { type: String, required: true },
            auth:   { type: String, required: true },
        },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    }],
    settings: {
        notifications: {
            web:          { type: Boolean, default: true },
            email:        { type: Boolean, default: true },
            push:         { type: Boolean, default: true },
            newFollowers: { type: Boolean, default: true },
            postLikes:    { type: Boolean, default: true },
            comments:     { type: Boolean, default: true },
            newPost:      { type: Boolean, default: true },
        },
        privacy: {
            type: {
                followerApproval: { type: Boolean, default: true },
                showActivity: {
                    type: String,
                    enum: ['everyone', 'followers', 'onlyme'],
                    default: 'everyone',
                },
            },
            default: {},
        },
        interface: {
            defaultLanguage: { type: String, default: 'es' },
            defaultTheme:    { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
            default: {},
        },
        session: {
            type: {
                rememberSession: { type: Boolean, default: true },
            },
            default: {},
        },
    },
    vaultPepper: {
        type: String,
        required: false,
        trim: true,
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            required: false,
        },
        coordinates: {
            type: [Number],
            validate: {
                validator: function(v) {
                    return !v || (v.length === 2 && v.every(n => typeof n === 'number'));
                },
                message: props => `${props.value} is not a valid coordinates array`,
            },
        },
        country:     { type: String, trim: true, maxlength: 50, required: false },
        region:      { type: String, trim: true, maxlength: 50, required: false },
        countryCode: { type: String, trim: true, maxlength: 2 },
        regionCode:  { type: String, trim: true, maxlength: 6 },
        city:        { type: String, trim: true, maxlength: 50 },
        lastUpdated: { type: Date },
        source: {
            type: String,
            enum: ['manual', 'geocoding', 'ip', 'gps', null],
        },
    },
    geohash: {
        type: String,
        default: null,
        index: true,
    },
    geoHistory: {
        type: [GeoHistorySchema],
        default: [],
    },
    lastActivityViewed: {
        type: Date,
        default: Date.now,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
    updated_at: {
        type: Date,
        default: Date.now,
    },
});

/**
 * Generates a unique, sanitised `name` for a new profile.
 *
 * Resolution order for the base token:
 *  1. Local part of the email address (sanitised to `[a-z0-9]`).
 *  2. Concatenation of `given_name` + `family_name` arguments (sanitised).
 *  3. Fallback literal `'user'`.
 *
 * Uniqueness strategy:
 *  The base token is first tried as-is (truncated to 15 chars). On collision
 *  a random 4-digit numeric suffix (1000–9999) is appended and the attempt is
 *  retried up to `MAX_ATTEMPTS` times. Using a random rather than sequential
 *  suffix eliminates the predictability that makes sequential counters prone
 *  to thundering-herd races under concurrent registration load.
 *
 *  Uniqueness is checked against the global `name` field with no `cid` filter,
 *  mirroring the actual database index `name_1` which is collection-wide.
 *  Scoping the check to `{ name, cid }` would produce false negatives:
 *  a name already taken by another tenant would pass the check and then
 *  cause an E11000 on insert.
 *
 * @param {string|null} email - User email address; used as primary name source.
 * @param {string|null} name  - Display name fallback (given + family name).
 * @returns {Promise<string>} A unique name that passes schema validation.
 */
async function generateUniqueName(email, name) {
    const MAX_ATTEMPTS = 10;

    const sanitize = (str) => {
        if (!str) return '';
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    let baseName = '';
    if (email) {
        baseName = sanitize(email.split('@')[0]);
    }
    if (!baseName && name) {
        baseName = sanitize(name);
    }
    if (!baseName) {
        baseName = 'user';
    }
    while (baseName.length < 3) {
        baseName += Math.floor(Math.random() * 10).toString();
    }

    const candidate = baseName.slice(0, 15);
    const isTakenClean = await this.findOne({ name: candidate }).lean();
    if (!isTakenClean) {
        return candidate;
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const suffix       = (Math.floor(Math.random() * 9000) + 1000).toString();
        const maxBase      = 15 - suffix.length;
        const suffixedName = `${baseName.slice(0, maxBase)}${suffix}`;
        const isTaken      = await this.findOne({ name: suffixedName }).lean();
        if (!isTaken) {
            return suffixedName;
        }
    }

    const fallback = `user${Date.now().toString().slice(-8)}`.slice(0, 15);
    return fallback;
}

/**
 * Pre-validate hook: seeds `author` and `name` on new documents.
 *
 * - `author`: SHA-256 hash of the email address, used as a stable,
 *   opaque profile identifier across the platform.
 * - `name`: delegates to `generateUniqueName` when not explicitly provided.
 *   The hook is skipped when `name` is already set, allowing callers such as
 *   `verifyCode` to pre-compute and inject the name before instantiating the
 *   document, avoiding a redundant uniqueness check.
 *
 * Only executes on new documents (`this.isNew`).
 */
profileSchema.pre('validate', async function(next) {
    if (this.isNew) {
        if (!this.author && this.email) {
            this.author = crypto.createHash('sha256').update(this.email).digest('hex');
        }
        if (!this.name) {
            this.name = await generateUniqueName.call(
                this.constructor,
                this.email,
                `${this.given_name || ''}${this.family_name || ''}`
            );
        }
    }
    next();
});

/**
 * Pre-save hook: handles password hashing, push subscription cap,
 * geohash computation and geo history rotation.
 *
 * - Password: bcrypt-hashed (cost 10) only when modified.
 * - Push subscriptions: capped at 3 most recent entries.
 * - Location: when `location.coordinates` is modified the geohash is
 *   recomputed at precision 6 (~1.2 km) and the previous location is
 *   prepended to `geoHistory` (max 5 entries, oldest pruned).
 */
profileSchema.pre('save', async function(next) {
    if (this.isModified('password') && this.password) {
        const salt  = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }

    if (this.isModified('pushSubscriptions') && this.pushSubscriptions.length > 3) {
        this.pushSubscriptions.splice(0, this.pushSubscriptions.length - 3);
    }

    if (this.isModified('location') && this.location && this.location.coordinates) {
        this._originalLocation         = this.toObject({ getters: false }).location;
        this._originalLocation.geohash = this.geohash;
    }

    if (this.isModified('location')) {
        if (this.location && this.location.coordinates) {
            if (
                this._originalLocation &&
                JSON.stringify(this.location.coordinates) !==
                    JSON.stringify(this._originalLocation.coordinates)
            ) {
                const oldHistory = {
                    location: {
                        type:        this._originalLocation.type || 'Point',
                        coordinates: this._originalLocation.coordinates,
                    },
                    geohash:     this._originalLocation.geohash,
                    countryCode: this._originalLocation.countryCode,
                    regionCode:  this._originalLocation.regionCode,
                    city:        this._originalLocation.city,
                    source:      this._originalLocation.source,
                    created_at:  new Date(this._originalLocation.lastUpdated || Date.now()),
                };
                this.geoHistory.push(oldHistory);
                if (this.geoHistory.length > 5) {
                    this.geoHistory.splice(0, this.geoHistory.length - 5);
                }
            }
            const [lon, lat] = this.location.coordinates;
            if (
                this.location?.type === 'Point' &&
                typeof lon === 'number' &&
                typeof lat === 'number'
            ) {
                this.geohash               = ngeohash.encode(lat, lon, 6);
                this.location.lastUpdated  = new Date();
            } else {
                this.geohash  = null;
                this.location = null;
            }
        } else {
            this.geohash  = null;
            this.location = null;
        }
    }

    next();
});

/**
 * Post-save hook: triggers cache invalidation for the saved profile so
 * that subsequent reads reflect the latest state without waiting for TTL
 * expiry.
 *
 * @param {Document} doc - The persisted profile document.
 */
profileSchema.post('save', async function(doc) {
    await invalidateCacheVersion(doc.cid, doc.author);
});

/**
 * Compares a plaintext password candidate against the stored bcrypt hash.
 *
 * @param {string} candidatePassword - The plaintext password to verify.
 * @returns {Promise<boolean>} `true` if the password matches.
 */
profileSchema.methods.comparePassword = async function(candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * Updates a single settings key for a profile and invalidates the cache.
 *
 * Accepts both raw keys (`'privacy.showActivity'`) and aliased keys
 * (`'activityVisibility'`) for backward compatibility with legacy clients.
 * All values are coerced to their declared types (boolean or string) before
 * being persisted. Throws on unknown keys or invalid enum values.
 *
 * @param {string} cid    - Tenant identifier.
 * @param {string} author - Profile author hash.
 * @param {string} key    - Settings path (with or without `settings.` prefix).
 * @param {*}      value  - New value; coerced to the declared type.
 * @returns {Promise<Object>} The updated profile as a lean object.
 * @throws {Error} If `key` is invalid or `value` fails enum validation.
 */
profileSchema.statics.updateSettings = async function(cid, author, key, value) {
    let sanitizedKey = key.startsWith('settings.') ? key.replace('settings.', '') : key;

    const keyAliases = {
        'privacy.activityVisibility':   'privacy.showActivity',
        'activityVisibility':           'privacy.showActivity',
        'followerApproval':             'privacy.followerApproval',
        'notifications.types.replies':  'notifications.comments',
        'notifications.types.likes':    'notifications.postLikes',
        'notifications.types.newFollowers': 'notifications.newFollowers',
        'notifications.types.newPosts': 'notifications.newPost',
        'notifications.types.newPost':  'notifications.newPost',
    };

    if (keyAliases[sanitizedKey]) {
        sanitizedKey = keyAliases[sanitizedKey];
    }

    const validPaths = {
        'notifications.web':          'boolean',
        'notifications.email':        'boolean',
        'notifications.push':         'boolean',
        'notifications.newFollowers': 'boolean',
        'notifications.postLikes':    'boolean',
        'notifications.comments':     'boolean',
        'notifications.newPost':      'boolean',
        'privacy.followerApproval':   'boolean',
        'privacy.showActivity':       'string',
        'interface.defaultLanguage':  'string',
        'interface.defaultTheme':     'string',
        'session.rememberSession':    'boolean',
    };

    if (!Object.prototype.hasOwnProperty.call(validPaths, sanitizedKey)) {
        throw new Error(`Invalid settings key: ${key}`);
    }

    const toBoolean = (val) =>
        (val === false || val === 'false' || val === 0 || val === '0') ? false : true;

    let processedValue;
    const expectedType = validPaths[sanitizedKey];

    if (expectedType === 'boolean') {
        processedValue = toBoolean(value);
    } else {
        if (sanitizedKey === 'privacy.showActivity') {
            const validVisibility = ['everyone', 'followers', 'onlyme'];
            if (!validVisibility.includes(value)) {
                throw new Error(
                    `Invalid showActivity value: ${value}. must be one of ${validVisibility.join(', ')}`
                );
            }
        }
        processedValue = String(value);
    }

    const updateFields = {
        [`settings.${sanitizedKey}`]: processedValue,
        $currentDate: { updated_at: true },
    };

    if (sanitizedKey === 'interface.defaultLanguage') {
        updateFields.locale = processedValue;
    }

    const updatedProfile = await this.findOneAndUpdate(
        { author, cid },
        { $set: updateFields },
        { new: true, runValidators: true }
    ).lean();

    if (!updatedProfile) {
        throw new Error('Profile not found');
    }

    await invalidateCacheVersion(cid, author);

    return updatedProfile;
};

/**
 * Finds or creates a profile for the given user within a tenant, then
 * optionally updates geolocation data and triggers onboarding suggestions
 * for first-time users.
 *
 * On existing profiles, the `picture` field is refreshed from the SSO
 * payload unless it has been customised (base64 or CDN-hosted image).
 *
 * Onboarding suggestion generation is fire-and-forget: errors are logged
 * but never propagate to the caller.
 *
 * @param {Object}      user               - SSO user payload.
 * @param {string}      user.author        - Author hash.
 * @param {string}      user.email         - User email.
 * @param {string}      [user.given_name]  - First name.
 * @param {string}      [user.family_name] - Last name.
 * @param {string}      [user.picture]     - Avatar URL from SSO.
 * @param {string}      [user.locale]      - User locale.
 * @param {string}      cid                - Tenant identifier.
 * @param {Object|null} [geoData]          - Optional geo data to update location.
 * @param {Object}      [options]          - Behavioural flags.
 * @param {boolean}     [options.skipSuggestions=false] - Skip onboarding suggestions.
 * @returns {Promise<Document>} The profile document (new or existing).
 * @throws {Error} If `cid` does not correspond to a known client.
 */
profileSchema.statics.ensureProfileExists = async function(user, cid, geoData = null, options = {}) {
    const clientExists = await getClientCached(cid);
    if (!clientExists) {
        throw new Error(`Cannot create profile for invalid Client: ${cid}`);
    }

    let profile      = await this.findOne({ author: user.author, cid });
    let isNewProfile = false;

    if (!profile) {
        const fullName   = `${user?.given_name || ''}${user?.family_name || ''}`.trim();
        const uniqueName = await generateUniqueName.call(this, user?.email, fullName);
        profile = new this({
            cid,
            author:           user.author,
            name:             uniqueName,
            given_name:       user.given_name,
            family_name:      user.family_name,
            email:            user.email,
            picture:          user.picture,
            locale:           user.locale,
            location:         null,
            lastActivityDate: new Date(),
        });
        isNewProfile = true;
    } else {
        const isBase64      = /^data:image\/[a-z]+;base64,/.test(profile.picture);
        const isFromBaseUrl = profile.picture?.startsWith(process.env.BASE_URL);
        if (!isBase64 && !isFromBaseUrl && profile.picture !== user.picture) {
            profile.picture    = user.picture;
            profile.updated_at = Date.now();
        }
        profile.lastActivityDate = new Date();
    }

    const savedProfile = await profile.save();

    if (geoData && geoData.lon && geoData.lat) {
        await this.updateProfileLocation(profile.cid, profile.author, geoData);
    }

    if (isNewProfile && !options.skipSuggestions) {
        generateOnboardingSuggestions(savedProfile.author, savedProfile.cid).catch(
            err => console.error('Error triggering onboarding suggestions:', err.message)
        );
    }

    return profile;
};

/**
 * Returns a paginated list of likes made by the profile.
 * Delegates to `paginationFactory` with `created_at`-based keyset cursor.
 * Populates the `post_id` / `comment_id` reference with title, link,
 * description, type, text, author and created_at.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch likes for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileLike documents.
 */
profileSchema.statics.getMoreLikes = paginationFactory(
    'ProfileLike',
    'profile_id',
    '_id',
    [{
        path:    'post_id comment_id',
        select:  'title link description type text author created_at post',
        options: { strictPopulate: false },
    }]
);

/**
 * Returns a paginated list of comments made by the profile.
 * Populates the associated `post_id` with title, link, description and type.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch comments for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileComment documents.
 */
profileSchema.statics.getMoreComments = paginationFactory(
    'ProfileComment',
    'profile_id',
    '_id',
    [{
        path:    'post_id',
        select:  'title link description type',
        options: { strictPopulate: false },
    }]
);

/**
 * Returns a paginated list of shares made by the profile.
 * Populates the associated `post_id` with title, link, description and type.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch shares for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileShare documents.
 */
profileSchema.statics.getMoreShares = paginationFactory(
    'ProfileShare',
    'profile_id',
    '_id',
    [{
        path:    'post_id',
        select:  'title link description type',
        options: { strictPopulate: false },
    }]
);

/**
 * Returns a paginated list of bookmarks saved by the profile.
 * Populates the associated `post_id` with title, link, description and type.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch bookmarks for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileBookmark documents.
 */
profileSchema.statics.getMoreBookmarks = paginationFactory(
    'ProfileBookmark',
    'profile_id',
    '_id',
    [{
        path:    'post_id',
        select:  'title link description type',
        options: { strictPopulate: false },
    }]
);

/**
 * Returns a paginated list of followers for the profile.
 * Populates `follower_id` with author, name, picture, family_name, locale
 * and given_name fields.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch followers for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileFollower documents.
 */
profileSchema.statics.getMoreFollowers = paginationFactory(
    'ProfileFollower',
    'profile_id',
    '_id',
    [{
        path:    'follower_id',
        select:  'author name picture family_name locale given_name',
        options: { strictPopulate: false },
    }]
);

/**
 * Returns a paginated list of profiles that this profile is following.
 * Populates `following_id` with author, name, picture, family_name, locale
 * and given_name fields.
 *
 * @function
 * @param {mongoose.Types.ObjectId} profile_id - Profile to fetch following for.
 * @param {mongoose.Types.ObjectId} [lastId]   - Cursor: last document _id from previous page.
 * @returns {Promise<Document[]>} Array of populated ProfileFollowing documents.
 */
profileSchema.statics.getMoreFollowing = paginationFactory(
    'ProfileFollowing',
    'profile_id',
    '_id',
    [{
        path:    'following_id',
        select:  'author name picture family_name locale given_name',
        options: { strictPopulate: false },
    }]
);

/**
 * Appends a push subscription to the profile's `pushSubscriptions` array,
 * capping the array at the 3 most recent entries via `$slice`.
 *
 * @param {string} cid          - Tenant identifier.
 * @param {string} author       - Profile author hash.
 * @param {Object} subscription - Web Push subscription object.
 * @returns {Promise<Document|null>} Updated profile document or `null`.
 */
profileSchema.statics.addPushSubscription = async function(cid, author, subscription) {
    return this.findOneAndUpdate(
        { cid, author },
        {
            $push: {
                pushSubscriptions: {
                    $each:  [subscription],
                    $slice: -3,
                },
            },
        },
        { new: true }
    );
};

/**
 * Updates the geolocation data for a profile atomically.
 *
 * Computes a geohash at precision 6 from the supplied coordinates, builds
 * a history entry, and appends it to `geoHistory` (capped at 5 entries).
 * All undefined address fields are stripped before persisting.
 * Invalidates the profile cache upon success.
 *
 * @param {string}        cid              - Tenant identifier.
 * @param {string}        author           - Profile author hash.
 * @param {Object}        geoData          - Geolocation payload.
 * @param {number|string} geoData.lat      - Latitude.
 * @param {number|string} geoData.lon      - Longitude.
 * @param {string}        [geoData.country]      - Country name.
 * @param {string}        [geoData.region]       - Region name.
 * @param {string}        [geoData.countryCode]  - ISO 3166-1 alpha-2 code.
 * @param {string}        [geoData.regionCode]   - ISO 3166-2 region code.
 * @param {string}        [geoData.city]         - City name.
 * @param {'manual'|'geocoding'|'ip'|'gps'} [geoData.source] - Location source.
 * @returns {Promise<Object|null>} Updated profile as lean object, or `null`
 *   if coordinates are invalid.
 * @throws {Error} If the profile is not found.
 */
profileSchema.statics.updateProfileLocation = async function(cid, author, geoData = {}) {
    try {
        const lat = parseFloat(geoData.lat);
        const lon = parseFloat(geoData.lon);

        if (isNaN(lat) || isNaN(lon) || !geoData.lat || !geoData.lon) {
            return null;
        }

        const geohash = ngeohash.encode(lat, lon, 6);

        const location = {
            type:        'Point',
            coordinates: [lon, lat],
            country:     geoData.country     ? String(geoData.country).trim().slice(0, 50)                 : undefined,
            region:      geoData.region      ? String(geoData.region).trim().slice(0, 50)                  : undefined,
            countryCode: geoData.countryCode ? String(geoData.countryCode).trim().toUpperCase().slice(0, 2) : undefined,
            regionCode:  geoData.regionCode  ? String(geoData.regionCode).trim().toUpperCase().slice(0, 5)  : undefined,
            city:        geoData.city        ? String(geoData.city).trim().slice(0, 50)                    : undefined,
            lastUpdated: new Date(),
            source:      geoData.source && ['manual', 'geocoding', 'ip', 'gps'].includes(geoData.source)
                ? geoData.source
                : undefined,
        };

        Object.keys(location).forEach(key => {
            if (location[key] === undefined) delete location[key];
        });

        const historyEntry = {
            location: {
                type:        'Point',
                coordinates: [lon, lat],
            },
            geohash,
            countryCode: location.countryCode || null,
            regionCode:  location.regionCode  || null,
            city:        location.city        || null,
            source:      location.source      || null,
            created_at:  new Date(),
        };

        const updatedProfile = await this.findOneAndUpdate(
            { cid, author },
            {
                $set: {
                    updated_at:       new Date(),
                    location,
                    geohash,
                    lastActivityDate: new Date(),
                },
                $push: {
                    geoHistory: {
                        $each:  [historyEntry],
                        $slice: -5,
                    },
                },
            },
            { new: true, runValidators: true, lean: true }
        );

        if (!updatedProfile) {
            throw new Error('Profile not found');
        }

        await invalidateCacheVersion(cid, author);

        return updatedProfile;
    } catch (error) {
        console.error('[Profile Model] Error updating location:', error.message);
        throw error;
    }
};

/**
 * Exposes `generateUniqueName` as a model static so that callers outside the
 * model layer (e.g. `registrationController.verifyCode`) can pre-compute a
 * collision-free name before constructing and saving a document.
 *
 * Pre-computing the name before the `new Profile(...)` call means the
 * `pre('validate')` hook finds `this.name` already set and skips its own
 * uniqueness check, avoiding a redundant round-trip to the database and
 * eliminating the race window between the check and the insert.
 *
 * @param {string|null} email - User email address; primary name source.
 * @param {string|null} name  - Display name fallback (given + family name).
 * @returns {Promise<string>} A unique name guaranteed not to exist in the collection.
 */
profileSchema.statics.generateUniqueName = function(email, name) {
    return generateUniqueName.call(this, email, name);
};

/**
 * Index: email + cid
 * Covers SSO/auth lookups: `findOne({ email, cid })`.
 */
profileSchema.index({ email: 1, cid: 1 });

/**
 * Index: 2dsphere on location
 * Required for geospatial queries (`$near`, `$geoWithin`).
 */
profileSchema.index({ location: '2dsphere' });

/**
 * Index: cid + followersCount (descending)
 * Covers `searchNewFollowers` sort: `find({ cid, ... }).sort({ followersCount: -1 })`.
 */
profileSchema.index({ cid: 1, followersCount: -1 });

/**
 * Index: cid + geohash + followersCount
 * Covers geo-scoped suggestion queries: find profiles near a location ranked
 * by popularity within a tenant.
 */
profileSchema.index({ cid: 1, geohash: 1, followersCount: -1 });

/**
 * Index: author + cid (unique)
 * The dominant query pattern across the entire service:
 * `findOne({ author, cid })`. Declared unique to enforce one profile per
 * author per tenant at the database level.
 */
profileSchema.index({ author: 1, cid: 1 }, { unique: true });

/**
 * Text index: name, given_name, family_name, author
 *
 * Covers full-text search via `findIdsByText` in profileService.
 *
 * Weight rationale:
 *  - `name` (10) and `author` (10): unique identifiers — highest relevance.
 *  - `given_name` (5) and `family_name` (5): display names — secondary relevance.
 *
 * IMPORTANT — cross-tenant isolation:
 * MongoDB text indexes do not support a `cid` prefix filter natively.
 * Tenant isolation MUST be enforced at the query layer by adding a `cid`
 * equality filter alongside `$text`:
 *   `Model.find({ cid, $text: { $search: term } })`
 */
profileSchema.index(
    {
        name:        'text',
        given_name:  'text',
        family_name: 'text',
        author:      'text',
    },
    {
        name: 'profile_text_search',
        weights: {
            name:        10,
            given_name:   5,
            family_name:  5,
            author:      10,
        },
    }
);

module.exports = mongoose.model('Profile', profileSchema);