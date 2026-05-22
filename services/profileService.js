/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/profileService.js */
const { mongoose } = require('../db');
const Profile = require('../models/Profile');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileFollowRequest = require('../models/ProfileFollowRequest');
const ProfileBlock = require('../models/ProfileBlock');
const ProfileLike = require('../models/ProfileLike');
const Comment = require('../models/Comment');
const ProfileShare = require('../models/ProfileShare');
const ProfileBookmark = require('../models/ProfileBookmark');
const Post = require('../models/Post');
const ProfileSuggestion = require('../models/ProfileSuggestion');

const { cacheClient } = require('./cacheService');
const { validateSearchQuery } = require('../utils/textUtils');
const { loadOptionalModule } = require('../utils/featureLoader');
const activeUsersService = require('./activeUsersService');

const PROFILE_CACHE_TTL = 300;
const PAGINATION_LIMIT = 15;
const FOLLOWER_LIMIT = 25;

/**
 * Loads enterprise modules optionally.
 * @returns {Object} Loaded models or null.
 */
const getEnterpriseModels = () => {
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    return {
        GamificationProfile: Enterprise?.GamificationProfile || null,
        GamificationLevel: Enterprise?.GamificationLevel || null
    };
};

/**
 * Generates the specific cache key for binary artifacts used by resilienceService.
 * Kept in sync with profileController logic.
 * @param {string} cid - Client ID.
 * @param {string} author - Author ID.
 * @returns {string} The cache key.
 */
const getBinaryArtifactKey = (cid, author) => `cid:${cid}:profile:${author}:binary`;

/**
 * Retrieves a user profile with extensive relation hydration.
 * Handles caching strategies and enterprise gamification layers.
 * @param {string} author - The author identifier.
 * @param {string} cid - The client identifier.
 * @param {Object} options - Configuration options for population.
 * @returns {Promise<Object>} The hydrated profile object.
 */
const getProfile = async (author, cid, options = {}) => {
    if (!author || !cid) throw new Error('Author and CID are required');

    const { currentUser = null, payloadUser = null, geoData = null, includeRelations = false, includeCounts = false, includeSettings = false, includeActivity = false, includeBookmarks = false, includeNotifications = false, includeSuggestions = false, forceRefresh = false } = options;

    const isSessionUser = currentUser && currentUser === author;
    const cacheKey = await generateCacheKey(cid, author, options);

    if (!isSessionUser && !forceRefresh) {
        const cached = await cacheClient.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    let profile;
    if (isSessionUser && payloadUser) {
        profile = await Profile.ensureProfileExists(payloadUser, cid, geoData);
    } else {
        profile = await Profile.findOne({ author, cid }).lean();
        if (!profile) throw new Error('Profile not found');
    }

    const result = {
        _id: profile._id, author: profile.author, given_name: profile.given_name, family_name: profile.family_name,
        name: profile.name, picture: profile.picture, background: profile.background, locale: profile.locale,
        trust: profile.trust,
        created_at: profile.created_at, updated_at: profile.updated_at,
        visibility: profile.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
        followerApproval: profile.settings?.privacy?.followerApproval || false,
        isFollowing: false, isFollowRequestSent: false, avatarFrameUrl: null, avatarFrameType: null, levelName: null, levelOrder: null
    };

    const { GamificationProfile, GamificationLevel } = getEnterpriseModels();
    
    if (GamificationProfile && GamificationLevel) {
        try {
            const gamificationProfile = await GamificationProfile.findOne({ profile_id: profile._id, cid })
                .populate('currentLevel').lean();

            const levelData = gamificationProfile?.currentLevel || {};
            const equipped = gamificationProfile?.equippedFrame || {};

            result.avatarFrameUrl = equipped.assetUrl || levelData.avatarFrameUrl || null;
            result.avatarFrameType = equipped.shape || 'CIRCULAR';
            result.levelName = levelData.name || null;
            result.levelOrder = levelData.order || null;

            if (isSessionUser) {
                const currentMinPoints = gamificationProfile?.currentLevel?.minPoints || 0;
                const nextLevel = gamificationProfile ? await GamificationLevel.findOne({ cid, minPoints: { $gt: currentMinPoints } }).sort({ minPoints: 1 }).select('name minPoints avatarFrameUrl order').lean() : null;

                result.gamification = gamificationProfile ? {
                    isEnabled: true, walletBalance: gamificationProfile.walletBalance || 0,
                    lifetimePoints: gamificationProfile.lifetimePoints || 0,
                    monthlyPoints: gamificationProfile.monthlyPoints || 0,
                    currentLevel: gamificationProfile.currentLevel,
                    nextLevel: nextLevel || null,
                    progress: {
                        current: gamificationProfile.lifetimePoints,
                        nextTarget: nextLevel ? nextLevel.minPoints : null,
                        percentage: nextLevel ? Math.min(100, Math.floor((gamificationProfile.lifetimePoints / nextLevel.minPoints) * 100)) : 100
                    }
                } : { isEnabled: false, walletBalance: 0, lifetimePoints: 0, currentLevel: null };
            }
        } catch (e) { if (isSessionUser) result.gamification = null; }
    } else if (isSessionUser) { result.gamification = null; }

    if (currentUser && currentUser !== author) {
        const currentProfile = await Profile.findOne({ author: currentUser, cid }).select('_id').lean();
        if (currentProfile) {
            const [isFollowing, requestSent] = await Promise.all([
                ProfileFollower.exists({ profile_id: profile._id, follower_id: currentProfile._id }),
                ProfileFollowRequest.exists({ profile_id: currentProfile._id, target_id: profile._id, status: 'pending' })
            ]);
            result.isFollowing = !!isFollowing;
            result.isFollowRequestSent = !!requestSent;
        }
    }

    if (isSessionUser) {
        if (includeSettings) result.settings = profile.settings;
        if (includeNotifications) result.pushSubscriptions = profile.pushSubscriptions;
        result.followRequests = await ProfileFollowRequest.find({ target_id: profile._id, status: 'pending' })
            .populate({ path: 'profile_id', select: 'author name picture', match: { cid } }).lean()
            .then(reqs => reqs.filter(r => r.profile_id).map(r => ({ _id: r._id, requester: { ...r.profile_id }, created_at: r.created_at })));
    }

    if (includeRelations) {
        const [followers, following, blocked] = await Promise.all([
            ProfileFollower.find({ profile_id: profile._id }).populate('follower_id', 'author name picture given_name family_name').limit(25).lean(),
            ProfileFollowing.find({ profile_id: profile._id }).populate('following_id', 'author name picture given_name family_name').limit(25).lean(),
            ProfileBlock.find({ blocker_id: profile._id })
                .populate('blocked_id', 'author name picture given_name family_name') 
                .lean()
        ]);
        let followersList = followers.filter(f => f.follower_id).map(f => ({ ...f.follower_id, isFollower: true }));
        let followingList = following.filter(f => f.following_id).map(f => f.following_id);
        let blockedList = blocked.filter(b => b.blocked_id).map(b => b.blocked_id);

        if (currentUser) {
            await Promise.all([hydrateUserRelations(followersList, currentUser, cid), 
                               hydrateUserRelations(followingList, currentUser, cid),
                               hydrateUserRelations(blockedList, currentUser, cid)]).catch(() => { });
        }
        await Promise.all([hydrateGamificationForProfiles(followersList, cid), 
                           hydrateGamificationForProfiles(followingList, cid),
                           hydrateGamificationForProfiles(blockedList, cid)]);

        result.followers = followersList;
        result.following = followingList;
        result.blocked = blockedList;
    }

    if (includeActivity && (isSessionUser || result.visibility === 'public' || (result.visibility === 'restricted' && result.isFollowing))) {
        const [likes, comments, shares] = await Promise.all([
            processLikes(profile._id, cid, 15, null, currentUser),
            processComments(profile._id, cid, 15, null, currentUser),
            processShares(profile._id, cid, 15, null, currentUser)
        ]);
        result.activity = { likes, comments, shares };
    }

    if (includeBookmarks) result.bookmarks = await processBookmarksOptimized(profile._id, cid, 15, null, currentUser);

    if (isSessionUser && includeSuggestions) {
        const suggestionDoc = await ProfileSuggestion.findOne({ profile_id: profile._id }).populate('suggestions.target_id', 'author name picture given_name family_name').lean();
        if (suggestionDoc?.suggestions) {
            let suggestionProfiles = suggestionDoc.suggestions.filter(s => s.target_id).map(s => ({ ...s.target_id, score: s.score }));
            if (currentUser) suggestionProfiles = await hydrateUserRelations(suggestionProfiles, currentUser, cid);
            await hydrateGamificationForProfiles(suggestionProfiles, cid);
            result.suggestions = suggestionProfiles;
        } else { result.suggestions = []; }
    }

    if (includeCounts) {
        result.counts = {
            followers: profile.followersCount || 0, following: profile.followingCount || 0,
            likes: profile.likesCount || 0, comments: profile.commentsCount || 0, shares: profile.sharesCount || 0,
            bookmarks: await ProfileBookmark.countDocuments({ profile_id: profile._id })
        };
    }

    if (!isSessionUser) await cacheClient.set(cacheKey, JSON.stringify(result), 'EX', PROFILE_CACHE_TTL);
    return result;
};

/**
 * Returns a lightweight trust snapshot for a profile without loading the full document.
 * Used by moderation and scoring subsystems that need only the trust fields.
 * Errors are swallowed and a safe default is returned so callers never fail
 * due to a missing or corrupt trust record.
 *
 * @param {string} author - Profile author hash.
 * @param {string} cid    - Tenant identifier.
 * @returns {Promise<{level: number, initial_score: number}>} Trust level and score.
 */
const getTrustSnapshot = async (author, cid) => {
    try {
        const profile = await Profile.findOne({ author, cid })
            .select('trust') 
            .lean();

        const trustData = profile?.trust || { level: 1, score: 0 };
        const currentLevel = trustData.level !== undefined ? trustData.level : 1;
        const currentScore = typeof trustData.score === 'number' ? trustData.score : 0; 

        return {
            level: currentLevel,
            initial_score: currentScore
        };

    } catch (error) {
        console.error(`[ProfileService] Error getting trust snapshot for ${author}:`, error);
        return { level: 1, initial_score: 0 };
    }
};

/**
 * Builds the Redis key that stores the current cache version counter for a profile.
 * Incrementing this key effectively invalidates all derived cache keys without
 * requiring an enumeration of every cached variant.
 *
 * @param {string} cid    - Tenant identifier.
 * @param {string} author - Profile author hash.
 * @returns {string} Redis key for the version counter.
 */
const profileVersionKey = (cid, author) => `profile:${cid}:${author}:v`;

/**
 * Builds the version-independent portion of a profile cache key, encoding all
 * option flags that produce distinct response shapes.
 *
 * @param {string} cid      - Tenant identifier.
 * @param {string} author   - Profile author hash.
 * @param {Object} [options={}] - Same options object accepted by `getProfile`.
 * @returns {string} Deterministic options-encoded cache key fragment.
 */
const getProfileCacheKey = (cid, author, options = {}) => {
    const { currentUser, includeRelations, includeCounts, includeSettings, includeActivity, includeBookmarks, includeSuggestions } = options;
    const optionsKey = [
        currentUser ? `cu:${currentUser}` : 'cu:none',
        `ir:${!!includeRelations}`, `ic:${!!includeCounts}`, `is:${!!includeSettings}`,
        `ia:${!!includeActivity}`, `ib:${!!includeBookmarks}`, `isu:${!!includeSuggestions}`
    ].join(':');
    return `${cid}:${author}:${optionsKey}`;
};

/**
 * Generates the fully-qualified, version-stamped Redis key for a profile response.
 * Bootstraps the version counter to `'1'` on first call if the key does not yet exist.
 *
 * @param {string} cid      - Tenant identifier.
 * @param {string} author   - Profile author hash.
 * @param {Object} [options={}] - Profile fetch options; same shape as `getProfile` options.
 * @returns {Promise<string>} Versioned cache key ready for use with `cacheClient.get/set`.
 */
const generateCacheKey = async (cid, author, options = {}) => {
    const vKey = profileVersionKey(cid, author);
    let version = await cacheClient.get(vKey);
    if (!version) {
        await cacheClient.set(vKey, '1');
        version = '1';
    }
    return `profile:${version}:${getProfileCacheKey(cid, author, options)}`;
};

/**
 * Invalidates the profile cache.
 * Updates the version version to invalidate JSON responses AND explicitly deletes
 * the binary artifact used by Resilience Service to ensure P2P consistency.
 * @param {string} cid 
 * @param {string} author 
 */
const invalidateProfileCache = async (cid, author) => {
    if (!author) return;
    try {
        const versionKey = profileVersionKey(cid, author);
        const binaryArtifactKey = getBinaryArtifactKey(cid, author);
        await Promise.all([
            cacheClient.incr(versionKey),
            cacheClient.del(binaryArtifactKey)
        ]);
    } catch (error) {
        console.error(`[ProfileService] Failed to invalidate cache for ${author}:`, error.message);
    }
};

/**
 * Returns a safe author object with sentinel values when the source document
 * is null or undefined. Prevents null-propagation errors when serialising
 * activity feed items whose author profiles may have been deleted.
 *
 * @param {Object|null} authorData - Raw profile document or `null`.
 * @returns {Object} Author object guaranteed to have all display fields populated.
 */
const getSafeAuthor = (authorData) => {
    if (!authorData) return { author: 'unknown', name: 'Unknown User', picture: '', given_name: 'Unknown', family_name: '' };
    return authorData;
};

/**
 * Performs a full-text search on a model and returns matching document IDs,
 * sorted by relevance score descending.
 *
 * When searching the `Profile` model the `cid` argument MUST be provided to
 * scope results to a single tenant. The Profile text index spans all tenants;
 * omitting `cid` would return cross-tenant matches and contaminate follower
 * search results with profiles from unrelated clients.
 *
 * For models that are not multi-tenant (e.g. `Post`, `Comment`) `cid` can be
 * omitted — the query falls back to a pure text search.
 *
 * @param {mongoose.Model} Model   - The Mongoose model to search against.
 * @param {string}         searchText - The text search expression.
 * @param {number}         [limit=500] - Maximum number of IDs to return.
 * @param {string|null}    [cid=null]  - Tenant identifier. Required for Profile searches.
 * @returns {Promise<mongoose.Types.ObjectId[]>} Ordered array of matching _id values.
 */
const findIdsByText = async (Model, searchText, limit = 500, cid = null) => {
    if (!searchText) return [];
    const filter = { $text: { $search: searchText } };
    if (cid) filter.cid = cid;
    return Model.find(
        filter,
        { score: { $meta: "textScore" } }
    )
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .select('_id')
        .lean()
        .then(docs => docs.map(d => d._id));
};

/**
 * Enriches a list of profile objects in-place with gamification display data
 * (avatar frame URL, frame shape, level name) fetched in a single batch query.
 *
 * No-ops gracefully when the Enterprise module is unavailable, the list is
 * empty, or any profile is missing an `_id`. Errors are swallowed and logged
 * so a gamification service outage never degrades the core profile response.
 *
 * @param {Object[]} profiles - Array of plain profile objects to enrich.
 * @param {string}   cid      - Tenant identifier used to scope gamification records.
 * @returns {Promise<Object[]>} The same array reference, mutated in-place.
 */
const hydrateGamificationForProfiles = async (profiles, cid) => {
    const { GamificationProfile } = getEnterpriseModels();
    if (!GamificationProfile || !profiles?.length) return profiles;
    const validProfiles = profiles.filter(p => p && p._id);
    if (!validProfiles.length) return profiles;

    const profileIds = validProfiles.map(p => p._id);

    try {
        const gamProfiles = await GamificationProfile.find({
            profile_id: { $in: profileIds }, cid
        })
            .populate('currentLevel', 'name avatarFrameUrl')
            .select('profile_id currentLevel equippedFrame')
            .lean();

        const gamMap = new Map();
        gamProfiles.forEach(gp => {
            const levelData = gp.currentLevel || {};
            const equipped = gp.equippedFrame || {};
            
            gamMap.set(gp.profile_id.toString(), {
                avatarFrameUrl: equipped.assetUrl || levelData.avatarFrameUrl,
                avatarFrameType: equipped.shape || 'CIRCULAR',
                levelName: levelData.name
            });
        });

        validProfiles.forEach(p => {
            const data = gamMap.get(p._id.toString());
            p.avatarFrameUrl = data?.avatarFrameUrl || null;
            p.avatarFrameType = data?.avatarFrameType || null;
            p.levelName = data?.levelName || null;
        });
    } catch (error) {
        console.error('Error hydrating gamification:', error);
    }
    return profiles;
};

/**
 * Enriches a list of profile objects in-place with the session user's
 * relationship flags: `isFollowing`, `isFollower`, `isFollowRequestSent`.
 *
 * Executes three targeted index queries in parallel (now covered by the
 * `{ follower_id: 1, profile_id: 1 }` indexes added to ProfileFollower and
 * ProfileFollowing) and resolves all flags via in-memory Set lookups.
 * A profile matching the session user's own ID receives all flags set to `false`.
 *
 * No-ops when `currentUserAuthor` is falsy or the list is empty.
 *
 * @param {Object[]} profilesList       - Array of plain profile objects to enrich.
 * @param {string}   currentUserAuthor  - Session user's author hash.
 * @param {string}   cid                - Tenant identifier.
 * @returns {Promise<Object[]>} The same array reference, mutated in-place.
 */
const hydrateUserRelations = async (profilesList, currentUserAuthor, cid) => {
    if (!currentUserAuthor || !profilesList?.length) return profilesList;

    const currentProfile = await Profile.findOne({ author: currentUserAuthor, cid }).select('_id').lean();
    if (!currentProfile) return profilesList;

    const myId = currentProfile._id;
    const targetIds = profilesList.filter(p => p && p._id).map(p => p._id);
    if (!targetIds.length) return profilesList;

    const [iFollowThem, theyFollowMe, iSentRequest] = await Promise.all([
        ProfileFollower.find({ follower_id: myId, profile_id: { $in: targetIds } }).select('profile_id').lean(),
        ProfileFollower.find({ follower_id: { $in: targetIds }, profile_id: myId }).select('follower_id').lean(),
        ProfileFollowRequest.find({ profile_id: myId, target_id: { $in: targetIds }, status: 'pending' }).select('target_id').lean()
    ]);

    const iFollowSet = new Set(iFollowThem.map(f => f.profile_id.toString()));
    const theyFollowSet = new Set(theyFollowMe.map(f => f.follower_id.toString()));
    const reqSet = new Set(iSentRequest.map(r => r.target_id.toString()));
    const myStr = myId.toString();

    for (const p of profilesList) {
        if (!p?._id) continue;
        const pid = p._id.toString();
        if (pid === myStr) {
            p.isFollowing = false; p.isFollower = false; p.isFollowRequestSent = false;
        } else {
            p.isFollowing = iFollowSet.has(pid);
            p.isFollower = theyFollowSet.has(pid);
            p.isFollowRequestSent = reqSet.has(pid);
        }
    }
    return profilesList;
};

/**
 * Fetches a paginated, hydrated list of likes made by a profile.
 * Supports keyset pagination via `lastId` and optional full-text filtering
 * over the associated Post and Comment collections.
 *
 * Result items are shaped differently depending on `fk_type`:
 * - `'post'`:    includes referer post metadata and the profile owner as author.
 * - `'comment'`: includes comment text, the comment's original author and the
 * parent post as referer.
 *
 * @param {mongoose.Types.ObjectId|string} profileId    - Profile whose likes to fetch.
 * @param {string}      cid         - Tenant identifier for author resolution.
 * @param {number}      [limit]     - Page size (defaults to PAGINATION_LIMIT).
 * @param {string|null} [searchQuery] - Optional text search term.
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last item on previous page).
 * @returns {Promise<Object[]>} Array of shaped like activity items.
 */
const processLikes = async (profileId, cid, limit = PAGINATION_LIMIT, searchQuery = null, currentUser = null, lastId = null) => {
    const targetProfileId = new mongoose.Types.ObjectId(profileId);
    const query = { profile_id: targetProfileId };

    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        query._id = { $lt: new mongoose.Types.ObjectId(lastId) };
    }

    if (searchQuery) {
        const [matchingPostIds, matchingCommentIds] = await Promise.all([
            findIdsByText(Post, searchQuery),
            findIdsByText(Comment, searchQuery)
        ]);

        if (!matchingPostIds.length && !matchingCommentIds.length) return [];

        query.$or = [
            { fk_type: 'post', fk_id: { $in: matchingPostIds } },
            { fk_type: 'comment', fk_id: { $in: matchingCommentIds } }
        ];
    }

    const likes = await ProfileLike.find(query)
        .sort({ _id: -1 })
        .limit(limit)
        .lean();

    if (!likes.length) return [];

    const postIds = [];
    const commentIds = [];
    likes.forEach(l => {
        if (l.fk_type === 'post') postIds.push(l.fk_id);
        else if (l.fk_type === 'comment') commentIds.push(l.fk_id);
    });

    const [posts, comments, currentUserProfile] = await Promise.all([
        postIds.length ? Post.find({ _id: { $in: postIds } }).select('title link description author created_at').lean() : [],
        commentIds.length ? Comment.find({ _id: { $in: commentIds } }).select('text author post entity parent created_at').lean() : [],
        Profile.findById(profileId).select('author name picture given_name family_name').lean()
    ]);

    const postMap = new Map(posts.map(p => [p._id.toString(), p]));
    const commentMap = new Map(comments.map(c => [c._id.toString(), c]));

    const authorIds = new Set();
    posts.forEach(p => { if (p.author) authorIds.add(p.author); });
    comments.forEach(c => { if (c.author) authorIds.add(c.author); });

    const authors = authorIds.size ? await Profile.find({ author: { $in: Array.from(authorIds) }, cid }).select('author name picture given_name family_name').lean() : [];

    if (currentUser) await hydrateUserRelations(authors, currentUser, cid);
    await hydrateGamificationForProfiles(authors, cid);

    const authorMap = new Map(authors.map(a => [a.author, a]));
    const safeCurrentUser = getSafeAuthor(currentUserProfile);

    const commentPostIds = comments.map(c => c.post).filter(Boolean);
    const commentPosts = commentPostIds.length ? await Post.find({ _id: { $in: commentPostIds } }).select('title link description').lean() : [];
    const commentPostMap = new Map(commentPosts.map(p => [p._id.toString(), p]));

    return likes.map(like => {
        if (like.fk_type === 'post') {
            const post = postMap.get(like.fk_id.toString());
            if (!post) return null;
            return {
                _id: like._id, fk_type: 'post', madeAt: like.created_at, created_at: like.created_at,
                author: safeCurrentUser,
                referer: { _id: post._id, title: post.title || post.description, link: post.link, description: post.description },
                title: post.title || post.description, link: post.link, description: post.description,
            };
        } else if (like.fk_type === 'comment') {
            const comment = commentMap.get(like.fk_id.toString());
            if (!comment) return null;
            const commentAuthor = authorMap.get(comment.author);
            const refererPost = commentPostMap.get(comment.post?.toString());
            
            const authorData = getSafeAuthor(commentAuthor);
            
            return {
                _id: like._id, fk_type: 'comment', madeAt: like.created_at, created_at: like.created_at,
                text: comment.text, author: authorData,
                authorOwner: currentUser ? (authorData.author === currentUser) : false,
                referer: refererPost ? { _id: refererPost._id, title: refererPost.title || refererPost.description, link: refererPost.link } : null,
                entity: comment.entity, replyId: comment.parent || null,
            };
        }
        return null;
    }).filter(Boolean);
};

/**
 * Fetches a paginated, hydrated list of comments made by a profile.
 * Only visible comments (`visible: true`) are returned.
 * Supports keyset pagination via `lastId` and inline text filtering
 * applied directly on the Comment collection's text index.
 *
 * @param {mongoose.Types.ObjectId|string} profileId    - Profile whose comments to fetch.
 * @param {string}      cid         - Tenant identifier for author resolution.
 * @param {number}      [limit]     - Page size (defaults to PAGINATION_LIMIT).
 * @param {string|null} [searchQuery] - Optional text search term applied on the Comment model.
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last item on previous page).
 * @returns {Promise<Object[]>} Array of shaped comment activity items.
 */
const processComments = async (profileId, cid, limit = PAGINATION_LIMIT, searchQuery = null, currentUser = null, lastId = null) => {
    const query = { profile_id: new mongoose.Types.ObjectId(profileId), visible: true };

    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        query._id = { $lt: new mongoose.Types.ObjectId(lastId) };
    }

    if (searchQuery) {
        query.$text = { $search: searchQuery };
    }

    const comments = await Comment.find(query).sort({ _id: -1 }).limit(limit).lean();
    if (!comments.length) return [];

    const postIds = comments.map(c => c.post).filter(Boolean);
    const posts = postIds.length ? await Post.find({ _id: { $in: postIds } }).select('title link description').lean() : [];
    const postMap = new Map(posts.map(p => [p._id.toString(), p]));

    const profile = await Profile.findById(profileId).select('author name picture given_name family_name').lean();
    if (currentUser && profile) await hydrateUserRelations([profile], currentUser, cid);
    if (profile) await hydrateGamificationForProfiles([profile], cid);

    const safeAuthor = getSafeAuthor(profile);

    return comments.map(c => {
        const postRef = postMap.get(c.post?.toString());
        return {
            _id: c._id, replyId: c.parent, entity: c.entity, text: c.text,
            created_at: c.created_at, madeAt: c.created_at, author: safeAuthor,
            authorOwner: currentUser ? (safeAuthor.author === currentUser) : false,
            referer: postRef ? {
                _id: postRef._id,
                title: postRef.title || postRef.description,
                link: postRef.link,
                description: postRef.description
            } : null
        };
    });
};

/**
 * Fetches a paginated, hydrated list of shares made by a profile.
 * Supports keyset pagination via `lastId` and optional text filtering
 * over the Post collection (IDs resolved via `findIdsByText`).
 *
 * @param {mongoose.Types.ObjectId|string} profileId    - Profile whose shares to fetch.
 * @param {string}      cid         - Tenant identifier for author resolution.
 * @param {number}      [limit]     - Page size (defaults to PAGINATION_LIMIT).
 * @param {string|null} [searchQuery] - Optional text search term for post filtering.
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last item on previous page).
 * @returns {Promise<Object[]>} Array of shaped share activity items.
 */
const processShares = async (profileId, cid, limit = PAGINATION_LIMIT, searchQuery = null, currentUser = null, lastId = null) => {
    const matchStage = { profile_id: new mongoose.Types.ObjectId(profileId) };

    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        matchStage._id = { $lt: new mongoose.Types.ObjectId(lastId) };
    }

    if (searchQuery) {
        const postIds = await findIdsByText(Post, searchQuery);
        if (!postIds.length) return [];
        matchStage.post_id = { $in: postIds };
    }

    const shares = await ProfileShare.find(matchStage).sort({ _id: -1 }).limit(limit).lean();
    if (!shares.length) return [];

    const postIds = shares.map(s => s.post_id);
    const posts = await Post.find({ _id: { $in: postIds } })
        .select('title link description type media created_at author')
        .lean();

    const postMap = new Map(posts.map(p => [p._id.toString(), p]));
    const authorSet = new Set(posts.map(p => p.author).filter(Boolean));

    const authors = authorSet.size ? await Profile.find({ author: { $in: Array.from(authorSet) }, cid }).select('author name picture given_name family_name').lean() : [];

    if (currentUser) await hydrateUserRelations(authors, currentUser, cid);
    await hydrateGamificationForProfiles(authors, cid);

    const authorMap = new Map(authors.map(a => [a.author, a]));

    return shares.map(share => {
        const post = postMap.get(share.post_id.toString());
        if (!post) return null;
        return {
            _id: share._id, madeAt: share.created_at,
            entity: { ...post, author: getSafeAuthor(authorMap.get(post.author)) }
        };
    }).filter(Boolean);
};

/**
 * Fetches a paginated, hydrated list of bookmarks saved by a profile.
 * Supports keyset pagination via `lastId` and optional text filtering
 * over the Post collection (IDs resolved via `findIdsByText`).
 *
 * @param {mongoose.Types.ObjectId|string} profileId    - Profile whose bookmarks to fetch.
 * @param {string}      cid         - Tenant identifier for author resolution.
 * @param {number}      [limit]     - Page size (defaults to PAGINATION_LIMIT).
 * @param {string|null} [searchQuery] - Optional text search term for post filtering.
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last item on previous page).
 * @returns {Promise<Object[]>} Array of shaped bookmark items.
 */
const processBookmarksOptimized = async (profileId, cid, limit = PAGINATION_LIMIT, searchQuery = null, currentUser = null, lastId = null) => {
    const matchStage = { profile_id: new mongoose.Types.ObjectId(profileId) };

    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        matchStage._id = { $lt: new mongoose.Types.ObjectId(lastId) };
    }

    if (searchQuery) {
        const postIds = await findIdsByText(Post, searchQuery);
        if (!postIds.length) return [];
        matchStage.post_id = { $in: postIds };
    }

    const bookmarks = await ProfileBookmark.find(matchStage).sort({ _id: -1 }).limit(limit).lean();
    if (!bookmarks.length) return [];

    const postIds = bookmarks.map(b => b.post_id);
    const posts = await Post.find({ _id: { $in: postIds } }).select('title link description type created_at author').lean();
    const postMap = new Map(posts.map(p => [p._id.toString(), p]));

    const authorSet = new Set(posts.map(p => p.author).filter(Boolean));
    const authors = authorSet.size ? await Profile.find({ author: { $in: Array.from(authorSet) }, cid }).select('author name picture given_name family_name').lean() : [];

    if (currentUser) await hydrateUserRelations(authors, currentUser, cid);
    await hydrateGamificationForProfiles(authors, cid);

    const authorMap = new Map(authors.map(a => [a.author, a]));

    return bookmarks.map(bookmark => {
        const post = postMap.get(bookmark.post_id.toString());
        if (!post) return null;
        return {
            _id: bookmark._id, created_at: bookmark.created_at,
            post: { ...post, author: getSafeAuthor(authorMap.get(post.author)) }
        };
    }).filter(Boolean);
};

/**
 * Returns a keyset-paginated list of followers for a profile, optionally
 * filtered by a text search term.
 *
 * Search path: `findIdsByText(Profile, query, 500, cid)` — tenant-scoped
 * to prevent cross-tenant profile leakage — then intersected against the
 * ProfileFollower collection using the `{ profile_id, follower_id }` index.
 *
 * Results are cached in Redis for 300 seconds per unique
 * (cid, author, searchQuery, lastId) combination.
 *
 * @param {string}      author      - Profile owner's author hash.
 * @param {string}      cid         - Tenant identifier.
 * @param {string|null} [query]     - Optional text search term.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last relation document).
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @returns {Promise<{status: string, result: Object[], has_more: boolean, last_id: string|null}>}
 */
const getMoreFollowers = async (author, cid, query = null, lastId = null, currentUser = null) => {
    const searchQuery = validateSearchQuery(query);

    const profile = await Profile.findOne({ author, cid }).select('_id').lean();
    if (!profile) throw new Error('Profile not found');

    const cacheKey = `followers:${cid}:${author}:${searchQuery || 'nq'}:${lastId || 'st'}`;
    const cached = await cacheClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const limit = FOLLOWER_LIMIT;
    const queryLimit = limit + 1;
    let result = [];

    let cursor = {};
    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        cursor = { _id: { $lt: new mongoose.Types.ObjectId(lastId) } };
    }

    if (searchQuery) {
        const matchedProfileIds = await findIdsByText(Profile, searchQuery, 500, cid);

        if (matchedProfileIds.length > 0) {
            const relations = await ProfileFollower.find({
                profile_id: profile._id,
                follower_id: { $in: matchedProfileIds },
                ...cursor,
            })
                .sort({ _id: -1 })
                .limit(queryLimit)
                .populate('follower_id', 'author name picture given_name family_name')
                .lean();

            result = relations.map(r => ({
                ...r.follower_id,
                rel_id: r._id,
            }));
        }
    } else {
        const relations = await ProfileFollower.find({
            profile_id: profile._id,
            ...cursor,
        })
            .sort({ _id: -1 })
            .limit(queryLimit)
            .populate('follower_id', 'author name picture given_name family_name')
            .lean();

        result = relations
            .filter(r => r.follower_id)
            .map(r => ({
                ...r.follower_id,
                rel_id: r._id,
            }));
    }

    const hasMore = result.length > limit;
    if (hasMore) {
        result.pop();
    }

    if (currentUser && result.length) {
        await hydrateUserRelations(result, currentUser, cid);
    }

    await hydrateGamificationForProfiles(result, cid);

    const response = {
        status: 'ok',
        result,
        has_more: hasMore,
        last_id: result.length > 0 ? result[result.length - 1].rel_id : null,
    };

    await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 300);

    return response;
};

/**
 * Returns a keyset-paginated list of profiles that a given profile is following,
 * optionally filtered by a text search term.
 *
 * Search path: `findIdsByText(Profile, query, 500, cid)` — tenant-scoped —
 * then intersected against ProfileFollowing using the `{ profile_id, following_id }` index.
 *
 * Results are cached in Redis for 300 seconds per unique
 * (cid, author, searchQuery, lastId) combination.
 *
 * @param {string}      author      - Profile owner's author hash.
 * @param {string}      cid         - Tenant identifier.
 * @param {string|null} [query]     - Optional text search term.
 * @param {string|null} [lastId]    - Keyset cursor (_id of last relation document).
 * @param {string|null} [currentUser] - Session user author hash for relation hydration.
 * @returns {Promise<{status: string, result: Object[], has_more: boolean, last_id: string|null}>}
 */
const getMoreFollowing = async (author, cid, query = null, lastId = null, currentUser = null) => {
    const searchQuery = validateSearchQuery(query);

    const profile = await Profile.findOne({ author, cid }).select('_id').lean();
    if (!profile) throw new Error('Profile not found');

    const cacheKey = `following:${cid}:${author}:${searchQuery || 'nq'}:${lastId || 'st'}`;
    const cached = await cacheClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const limit = FOLLOWER_LIMIT;
    const queryLimit = limit + 1;
    let result = [];

    let cursor = {};
    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        cursor = { _id: { $lt: new mongoose.Types.ObjectId(lastId) } };
    }

    if (searchQuery) {
        const matchedProfileIds = await findIdsByText(Profile, searchQuery, 500, cid);

        if (matchedProfileIds.length > 0) {
            const relations = await ProfileFollowing.find({
                profile_id: profile._id,
                following_id: { $in: matchedProfileIds },
                ...cursor,
            })
                .sort({ _id: -1 })
                .limit(queryLimit)
                .populate('following_id', 'author name picture given_name family_name')
                .lean();

            result = relations.map(r => ({
                ...r.following_id,
                rel_id: r._id,
            }));
        }
    } else {
        const relations = await ProfileFollowing.find({
            profile_id: profile._id,
            ...cursor,
        })
            .sort({ _id: -1 })
            .limit(queryLimit)
            .populate('following_id', 'author name picture given_name family_name')
            .lean();

        result = relations
            .filter(r => r.following_id)
            .map(r => ({
                ...r.following_id,
                rel_id: r._id,
            }));
    }

    const hasMore = result.length > limit;
    if (hasMore) {
        result.pop();
    }

    if (currentUser && result.length) {
        await hydrateUserRelations(result, currentUser, cid);
    }

    await hydrateGamificationForProfiles(result, cid);

    const response = {
        status: 'ok',
        result,
        has_more: hasMore,
        last_id: result.length > 0 ? result[result.length - 1].rel_id : null,
    };

    await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 300);

    return response;
};

/**
 * Returns a keyset-paginated list of mutual connections for the session user —
 * profiles that the session user follows AND that follow the session user back.
 *
 * Implementation uses a single aggregation pipeline on ProfileFollowing:
 * 1. Matches all profiles the session user follows.
 * 2. Performs a correlated `$lookup` on ProfileFollowers to check the reverse
 * relationship (covered by the `{ follower_id, profile_id }` index in MongoDB >= 5.0).
 * 3. Filters to only those that pass the mutual check.
 * 4. Joins with the Profile collection for display fields.
 * 5. Applies optional in-pipeline regex filter if a search query is provided.
 *
 * Each result is enriched with online presence data from `activeUsersService`.
 *
 * @param {string}      currentUser - Session user's author hash (from JWT).
 * @param {string}      cid         - Tenant identifier.
 * @param {string|null} [query]     - Optional name filter (regex, case-insensitive).
 * @param {string|null} [lastId]    - Keyset cursor (_id of last ProfileFollowing document).
 * @returns {Promise<{status: string, result: Object[], has_more: boolean, last_id: string|null}>}
 */
const getMutuals = async (currentUser, cid, query = null, lastId = null) => {
    const searchQuery = validateSearchQuery(query);
    const limit = FOLLOWER_LIMIT;
    const queryLimit = limit + 1;

    const profile = await Profile.findOne({ author: currentUser, cid }).select('_id').lean();
    if (!profile) throw new Error('Profile not found');

    const pipeline = [
        { $match: { profile_id: profile._id } },
        {
            $lookup: {
                from: 'profilefollowers',
                let: { target_id: '$following_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$profile_id', profile._id] },
                                    { $eq: ['$follower_id', '$$target_id'] }
                                ]
                            }
                        }
                    },
                    { $project: { _id: 1 } }
                ],
                as: 'mutual_check'
            }
        },
        { $match: { 'mutual_check.0': { $exists: true } } }
    ];

    if (lastId && mongoose.Types.ObjectId.isValid(lastId)) {
        pipeline.push({ $match: { _id: { $lt: new mongoose.Types.ObjectId(lastId) } } });
    }

    pipeline.push({
        $lookup: {
            from: 'profiles',
            localField: 'following_id',
            foreignField: '_id',
            as: 'profile_data'
        }
    });
    
    pipeline.push({ $unwind: '$profile_data' });

    if (searchQuery) {
        pipeline.push({
            $match: {
                $or: [
                    { 'profile_data.name': { $regex: searchQuery, $options: 'i' } },
                    { 'profile_data.given_name': { $regex: searchQuery, $options: 'i' } },
                    { 'profile_data.family_name': { $regex: searchQuery, $options: 'i' } }
                ]
            }
        });
    }

    pipeline.push(
        { $sort: { _id: -1 } },
        { $limit: queryLimit }
    );

    pipeline.push({
        $project: {
            rel_id: '$_id',
            _id: '$profile_data._id',
            author: '$profile_data.author',
            name: '$profile_data.name',
            picture: '$profile_data.picture',
            given_name: '$profile_data.given_name',
            family_name: '$profile_data.family_name',
            locale: '$profile_data.locale',
            lastActivityDate: '$profile_data.lastActivityDate'
        }
    });

    const results = await ProfileFollowing.aggregate(pipeline);

    const hasMore = results.length > limit;
    if (hasMore) results.pop();

    if (results.length) {
        await hydrateUserRelations(results, currentUser, cid);
    }
    await hydrateGamificationForProfiles(results, cid);

    const authorIds = results.map(r => r.author);
    const presenceMap = await activeUsersService.getUsersOnlineStatusBatch(authorIds, cid);

    const enrichedResults = results.map(user => {
        const presence = presenceMap[user.author] || { online: false, lastSeen: null };
        return {
            ...user,
            online: presence.online,
            lastSeen: presence.lastSeen
        };
    });

    return {
        status: 'ok',
        result: enrichedResults,
        has_more: hasMore,
        last_id: enrichedResults.length > 0 ? enrichedResults[enrichedResults.length - 1].rel_id : null
    };
};

/**
 * Blocks a profile on behalf of another, with cascading follow relationship cleanup.
 *
 * Accepts either a full profile object (with `_id` and `author`) or a raw
 * ObjectId for both arguments. When `author` is absent it is hydrated via a
 * targeted `findById` call so that cache invalidation and schema validation
 * always receive the required fields.
 *
 * Side effects (all executed in parallel after the block record is created):
 * - Removes the blocker → blocked following relationship.
 * - Removes the blocked → blocker follower relationship.
 * - Invalidates the Redis cache for both profiles.
 *
 * @param {Object|mongoose.Types.ObjectId} blockerInput - Blocker profile object or raw _id.
 * @param {Object|mongoose.Types.ObjectId} blockedInput - Blocked profile object or raw _id.
 * @param {string} cid - Tenant identifier for cache invalidation.
 * @returns {Promise<boolean>} `true` if the block was created; `false` if it already existed.
 */
const blockMember = async (blockerInput, blockedInput, cid) => {
    const blockerId = blockerInput._id || blockerInput;
    const blockedId = blockedInput._id || blockedInput;

    if (!blockerId || !blockedId) return false;

    let blockerAuthor = blockerInput.author;
    if (!blockerAuthor) {
        const bp = await Profile.findById(blockerId).select('author').lean();
        blockerAuthor = bp?.author;
    }

    let blockedAuthor = blockedInput.author;
    if (!blockedAuthor) {
        const bp = await Profile.findById(blockedId).select('author').lean();
        blockedAuthor = bp?.author;
    }

    const exists = await ProfileBlock.exists({ blocker_id: blockerId, blocked_id: blockedId });
    if (exists) return false;

    await ProfileBlock.create({ 
        blocker_id: blockerId, 
        blocked_id: blockedId, 
        blocked_author: blockedAuthor 
    });

    const promises = [
        ProfileFollowing.deleteOne({ profile_id: blockerId, following_id: blockedId }),
        ProfileFollower.deleteOne({ profile_id: blockedId, follower_id: blockerId })
    ];

    if (blockerAuthor) promises.push(invalidateProfileCache(cid, blockerAuthor));
    if (blockedAuthor) promises.push(invalidateProfileCache(cid, blockedAuthor));

    await Promise.all(promises);

    return true;
};

/**
 * Removes a block relationship between two profiles and invalidates their caches.
 *
 * Accepts either a full profile object (with `_id` and `author`) or a raw
 * ObjectId for both arguments. When `author` is absent it is hydrated via a
 * targeted `findById` call to satisfy cache invalidation requirements.
 *
 * Unlike `blockMember`, this operation does NOT restore any previously removed
 * follow relationships — those must be re-established explicitly by the user.
 *
 * @param {Object|mongoose.Types.ObjectId} blockerInput - Blocker profile object or raw _id.
 * @param {Object|mongoose.Types.ObjectId} blockedInput - Blocked profile object or raw _id.
 * @param {string} cid - Tenant identifier for cache invalidation.
 * @returns {Promise<boolean>} `true` if the block was removed; `false` if it did not exist.
 */
const unBlockMember = async (blockerInput, blockedInput, cid) => {
    const blockerId = blockerInput._id || blockerInput;
    const blockedId = blockedInput._id || blockedInput;

    if (!blockerId || !blockedId) return false;

    let blockerAuthor = blockerInput.author;
    if (!blockerAuthor) {
        const bp = await Profile.findById(blockerId).select('author').lean();
        blockerAuthor = bp?.author;
    }

    let blockedAuthor = blockedInput.author;
    if (!blockedAuthor) {
        const bp = await Profile.findById(blockedId).select('author').lean();
        blockedAuthor = bp?.author;
    }

    const deleted = await ProfileBlock.deleteOne({ blocker_id: blockerId, blocked_id: blockedId });
    if (deleted.deletedCount === 0) return false;

    const promises = [];
    if (blockerAuthor) promises.push(invalidateProfileCache(cid, blockerAuthor));
    if (blockedAuthor) promises.push(invalidateProfileCache(cid, blockedAuthor));

    await Promise.all(promises);

    return true;
};

/**
 * Returns all profiles blocked by the given profile, with basic display fields
 * populated from the blocked profile document.
 *
 * Note: this function has no pagination — it returns the full blocked list.
 * It is appropriate for use in settings screens where the complete list is
 * expected to be small. For feeds and suggestions, block status is checked
 * via `ProfileBlock.isBlocked` or upstream filters.
 *
 * @param {Object} blockerProfile     - Profile document; must contain `_id`.
 * @param {string} cid                - Tenant identifier (unused currently; reserved for future filtering).
 * @returns {Promise<Object[]>} Array of blocked profile display objects.
 */
const getBlockedList = async (blockerProfile, cid) => {
    const blocks = await ProfileBlock.find({ blocker_id: blockerProfile._id }).populate('blocked_id', 'author name picture given_name family_name').lean();
    return blocks.map(b => b.blocked_id);
};

/**
 * Removes a single suggestion entry from a profile's suggestion document.
 * Errors are swallowed and logged so a failed suggestion dismissal never
 * propagates as an HTTP error to the client.
 *
 * @param {mongoose.Types.ObjectId|string} profileId - The profile dismissing the suggestion.
 * @param {mongoose.Types.ObjectId|string} targetId  - The suggested profile to remove.
 * @returns {Promise<void>}
 */
const removeSuggestion = async (profileId, targetId) => {
    try {
        await ProfileSuggestion.updateOne({ profile_id: profileId }, { $pull: { suggestions: { target_id: targetId } } });
    } catch (error) { console.error('Error removing suggestion:', error); }
};

/**
 * Discovers profiles the session user does not yet follow, optionally filtered
 * by a search term, ranked by popularity.
 *
 * Strategy — Fetch-Over & Filter:
 * Rather than issuing a `$nin` against potentially thousands of following IDs,
 * the function fetches a bounded candidate batch (`BATCH_SIZE = 50`) from the
 * Profile collection, then checks which of those 50 candidates are already
 * followed using a targeted `{ profile_id, following_id }` index query.
 * The in-memory filter step is O(50) and avoids unbounded `$nin` scans entirely.
 *
 * Search uses case-insensitive `$regex` against name, given_name, family_name
 * and author. The term is escape-sanitised before use. Without a `^` anchor
 * the regex cannot use a B-tree prefix scan; MongoDB performs an index scan
 * over `{ cid, followersCount }` entries and evaluates the regex per entry.
 * This is acceptable given the hard `BATCH_SIZE` ceiling.
 *
 * @param {string}      author        - Session user's author hash.
 * @param {string}      cid           - Tenant identifier.
 * @param {string|null} [q]           - Optional search term (sanitised internally).
 * @param {string|null} [currentUser] - Author hash for relation hydration (may equal `author`).
 * @returns {Promise<{status: string, result: Object[], has_more: boolean}>}
 */
const searchNewFollowers = async (author, cid, q = null, currentUser = null) => {
    const cleanQuery = q ? q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    
    const myProfile = await Profile.findOne({ author, cid }).select('_id').lean();
    if (!myProfile) throw new Error('Profile not found');
    const myId = myProfile._id;

    const query = { 
        cid, 
        _id: { $ne: myId },
        isBanned: false,
        isDeleted: false
    };

    if (cleanQuery) {
        query.$or = [
            { name: { $regex: cleanQuery, $options: 'i' } },
            { given_name: { $regex: cleanQuery, $options: 'i' } },
            { family_name: { $regex: cleanQuery, $options: 'i' } },
            { author: { $regex: cleanQuery, $options: 'i' } }
        ];
    }

    const sortCriteria = cleanQuery ? { followersCount: -1 } : { followersCount: -1, lastActivityDate: -1 };

    const BATCH_SIZE = 50; 
    const TARGET_SIZE = 20;

    const candidates = await Profile.find(query)
        .select('author name picture given_name family_name levelName avatarFrameUrl followersCount') 
        .sort(sortCriteria)
        .limit(BATCH_SIZE)
        .lean();

    if (candidates.length === 0) {
        return { status: 'ok', result: [], has_more: false };
    }

    const candidateIds = candidates.map(c => c._id);

    const alreadyFollowing = await ProfileFollowing.find({
        profile_id: myId,
        following_id: { $in: candidateIds }
    }).select('following_id').lean();

    const followingSet = new Set(alreadyFollowing.map(f => f.following_id.toString()));

    let finalResult = candidates.filter(c => !followingSet.has(c._id.toString()));

    const hasMore = finalResult.length > TARGET_SIZE;
    finalResult = finalResult.slice(0, TARGET_SIZE);

    if (currentUser) {
        await hydrateUserRelations(finalResult, currentUser, cid);
    }

    return { status: 'ok', result: finalResult, has_more: hasMore };
};

/**
 * Higher-order pagination wrapper that applies the look-ahead strategy to any
 * async fetch function, converting a raw array result into a standardised
 * paginated response envelope.
 *
 * The wrapper requests `PAGINATION_LIMIT + 1` items, checks if the extra item
 * was returned (signalling more pages exist), removes it from the result set,
 * and returns the last `_id` as the next-page cursor.
 *
 * @param {Function} fn   - Async fetch function with signature `(profileId, cid, limit, ...rest) => Promise<Object[]>`.
 * @param {...*}     args - Arguments forwarded to `fn`; the third argument (limit) is overridden internally.
 * @returns {Promise<{status: string, result: Object[], has_more: boolean, last_id: string|null}>}
 */
const wrapPagination = async (fn, ...args) => {
    const limit = PAGINATION_LIMIT;
    const queryLimit = limit + 1; 
    const newArgs = [...args];
    newArgs[2] = queryLimit;

    const result = await fn(...newArgs);
    
    const hasMore = result.length > limit;
    if (hasMore) {
        result.pop();
    }

    return {
        status: 'ok',
        result,
        has_more: hasMore,
        last_id: result.length > 0 ? result[result.length - 1]._id : null
    };
};

module.exports = {
    getProfile,
    getMoreFollowing,
    getMoreFollowers,
    getMutuals,
    getMoreComments: async (author, cid, q, currentUser, lastId) => wrapPagination(processComments, (await Profile.findOne({ author, cid }).select('_id'))._id, cid, PAGINATION_LIMIT, q, currentUser, lastId),
    getMoreLikes: async (author, cid, q, currentUser, lastId) => wrapPagination(processLikes, (await Profile.findOne({ author, cid }).select('_id'))._id, cid, PAGINATION_LIMIT, q, currentUser, lastId),
    getMoreShares: async (author, cid, q, currentUser, lastId) => wrapPagination(processShares, (await Profile.findOne({ author, cid }).select('_id'))._id, cid, PAGINATION_LIMIT, q, currentUser, lastId),
    getMoreBookmarks: async (author, cid, q, currentUser, lastId) => wrapPagination(processBookmarksOptimized, (await Profile.findOne({ author, cid }).select('_id'))._id, cid, PAGINATION_LIMIT, q, currentUser, lastId),
    getMoreBlocked: async (author, cid, q) => {
        const profile = await Profile.findOne({ author, cid });
        const result = await getBlockedList(profile, cid);
        return { status: 'ok', result, has_more: false };
    },
    deleteProfileCache: invalidateProfileCache,
    getSingleSourceOfTruthProfile: async (author, cid, fullProfile = false) => {
        return await getProfile(author, cid, {
            currentUser: author, payloadUser: fullProfile, includeRelations: true, includeSettings: fullProfile,
            includeCounts: fullProfile, includeActivity: fullProfile, includeBookmarks: fullProfile,
            includeNotifications: fullProfile, includeSuggestions: fullProfile, forceRefresh: true
        });
    },
    searchNewFollowers,
    blockMember, 
    unBlockMember, 
    getBlockedList,
    processLikes, 
    processComments, 
    processShares, 
    removeSuggestion,
    getTrustSnapshot
};