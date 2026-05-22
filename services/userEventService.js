/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/userEventService.js */
const { sendNotificationAndLogActivity } = require('../utils/notificationUtils');
const activityService = require('./activityService');
const { queueReputationEvent } = require('./reputationService');
const { recordGeoActivity, recordActivityHit } = require('../utils/recordStatsActivity');
const { recordProfileActivity } = require('../utils/recordProfileActivity');
const { cacheService } = require('./cacheService');
const { loadOptionalModule } = require('../utils/featureLoader');
const { calculateTextQuality } = require('./contentQualityService');

const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Profile = require('../models/Profile');

// Lazy load Enterprise module safely
const getEnterpriseFunctions = () => {
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    return {
        recordGamificationActivity: Enterprise?.recordGamificationActivity || null
    };
};

const LIMIT_COMMENTS = parseInt(process.env.LIMIT_COMMENTS, 10) || 20;
const QUALITY_THRESHOLD = 0.3; // Minimum quality score to earn reputation

/**
 * Invalidates the User SideCar cache.
 * Forces a refresh of the user's interaction state (likes, bookmarks) for future requests.
 * @param {string} cid - Client ID
 * @param {string|ObjectId} profileId - User Profile ID
 */
const invalidateSidecar = async (cid, profileId) => {
    if (!cid || !profileId) return;
    try {
        const pidStr = profileId.toString();
        const pattern = `cid:${cid}:sidecar:${pidStr}:*`;
        await cacheService.deleteByPattern(pattern);
    } catch (error) {
        console.error('[UserEvent] Failed to invalidate sidecar:', error);
    }
};

/**
 * Helper to execute non-critical background tasks without blocking the main thread/response.
 * Uses Promise.allSettled to ensure UX resilience.
 * @param {Array<Promise>} promises 
 * @param {string} contextName 
 */
const runBackgroundTasks = async (promises, contextName) => {
    const results = await Promise.allSettled(promises);
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.error(`[UserEvent] Background task failed in ${contextName} (idx ${index}):`, result.reason?.message);
        }
    });
};

exports.onCommentAdded = async ({ req, entity, post, comment, profile, toxicityScore }) => {
    const { cid, user } = req;
    const author = user.author;
    const { recordGamificationActivity } = getEnterpriseFunctions();

    // 1. Calculate Content Quality (0.01 - 1.0)
    const qualityScore = calculateTextQuality(comment.text);

    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordGeoActivity(req, 'comment'),
        recordGeoActivity(req, 'comment', entity),
        recordActivityHit(`activity:comments:${cid}`, 'added', entity),
        recordProfileActivity(cid, author, 'comment-added', profile._id, comment.created_at, { toxicityScore }),
        
        sendNotificationAndLogActivity({
            cid, 
            author, 
            entity, 
            postId: post._id, 
            commentId: comment._id, 
            actionType: 'comment', 
            notificationType: 'comment_followers', 
            targetPreview: post.title,
            cacheKeys: [`cid:${cid}:thread:${entity}:limit:${LIMIT_COMMENTS}:last:initial`]
        })
    ];

    if (recordGamificationActivity) {
        tasks.push(recordGamificationActivity(cid, profile._id, 'COMMENT_CREATED', {
            entityId: entity,
            postId: post._id,
            commentId: comment._id,
            quality: qualityScore
        }));
    }

    // 2. REPUTATION: Reward Creation (Filtered by Quality)
    // Only queue if content meets minimum quality standard to prevent spam farming.
    if (qualityScore >= QUALITY_THRESHOLD) {
        tasks.push(queueReputationEvent({
            cid,
            target_profile_id: profile._id,
            source_profile_id: null, 
            event_type: 'post_created', // Mapped to creation weight
            entity_id: comment._id,
            source_trust_level: profile.trust?.level || 0,
            quality_score: qualityScore // Passed to processor for multiplier
        }));
    }

    await runBackgroundTasks(tasks, 'onCommentAdded');
};

exports.onReplyAdded = async ({ req, entity, post, reply, parentComment, profile, toxicityScore }) => {
    const { cid, user } = req;
    const author = user.author;
    const parentAuthor = parentComment.author;
    const { recordGamificationActivity } = getEnterpriseFunctions();

    // 1. Calculate Content Quality
    const qualityScore = calculateTextQuality(reply.text);

    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordGeoActivity(req, 'reply'),
        recordGeoActivity(req, 'reply', entity),
        recordActivityHit(`activity:replies:${cid}`, 'added', entity),
        recordProfileActivity(cid, author, 'reply-added', profile._id, reply.created_at, { toxicityScore })
    ];

    if (recordGamificationActivity) {
        tasks.push(recordGamificationActivity(cid, profile._id, 'REPLY_CREATED', {
            entityId: entity,
            postId: post._id,
            commentId: reply._id,
            parentId: parentComment._id,
            quality: qualityScore
        }));
    }

    if (author !== parentAuthor) {
        tasks.push(sendNotificationAndLogActivity({
            cid, 
            author, 
            entity, 
            postId: post._id, 
            commentId: parentComment._id, 
            replyId: reply._id, 
            actionType: 'reply', 
            notificationType: 'comment', 
            recipient: parentAuthor, 
            targetPreview: parentComment.text,
            cacheKeys: [`cid:${cid}:thread:${entity}:${parentComment._id}:limit:${LIMIT_COMMENTS}:last:none`]
        }));

        // 3. REPUTATION: Reward the Receiver (Filtered)
        // If the reply is garbage, the receiver doesn't get "Engagement Points" either.
        if (qualityScore >= QUALITY_THRESHOLD) {
            // Async lookup to find parent profile ID
            tasks.push((async () => {
                try {
                    const parentProfile = await Profile.findOne({ author: parentAuthor, cid }).select('_id');
                    if (parentProfile) {
                        return queueReputationEvent({
                            cid,
                            target_profile_id: parentProfile._id,
                            source_profile_id: profile._id, // The replier
                            event_type: 'reply_received',   
                            entity_id: reply._id,
                            source_trust_level: profile.trust?.level || 0,
                            quality_score: qualityScore
                        });
                    }
                } catch (e) {
                    console.error('[UserEvent] Failed to queue reply_received rep:', e.message);
                }
            })());
        }
    }

    // 4. REPUTATION: Reward the Creator (Filtered)
    if (qualityScore >= QUALITY_THRESHOLD) {
        tasks.push(queueReputationEvent({
            cid,
            target_profile_id: profile._id,
            source_profile_id: null,
            event_type: 'reply_created',
            entity_id: reply._id,
            source_trust_level: profile.trust?.level || 0,
            quality_score: qualityScore
        }));
    }

    await runBackgroundTasks(tasks, 'onReplyAdded');
};

exports.onPostLiked = async ({ req, entity, post, profile }) => {
    const { cid, user } = req;
    const author = user.author; 
    const cacheKey = `cid:${cid}:postLikes:${entity}:structure`;
    const { recordGamificationActivity } = getEnterpriseFunctions();
    
    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordGeoActivity(req, 'like'),
        recordGeoActivity(req, 'like', entity),
        recordActivityHit(`activity:likes:${cid}`, 'added', entity),
        recordProfileActivity(cid, author, 'like-given-added', profile._id, new Date()),
    ];

    if (author !== post.author) {
        // 1. Gamification
        if (recordGamificationActivity) {
            tasks.push(recordGamificationActivity(cid, post.author, 'LIKE_RECEIVED', {
                entityId: entity,
                postId: post._id,
                fromProfileId: profile._id, 
                isUserRef: true 
            }));
        }

        // 2. Notifications
        tasks.push(sendNotificationAndLogActivity({
            cid,
            author,
            entity,
            postId: post._id,
            actionType: 'like',
            notificationType: 'like',
            recipient: post.author,
            targetPreview: post.title,
            cacheKeys: [cacheKey]
        }));

        // 3. Reputation (Resolved Author)
        tasks.push((async () => {
            try {
                // post.author is String (SSO ID), map to Profile ObjectId
                const postOwnerProfile = await Profile.findOne({ author: post.author, cid }).select('_id');
                if (postOwnerProfile) {
                    await queueReputationEvent({
                        cid,
                        target_profile_id: postOwnerProfile._id,
                        source_profile_id: profile._id,
                        event_type: 'upvote',
                        entity_id: post._id,
                        source_trust_level: profile.trust?.level || 0
                        // Note: Likes do not have 'quality_score', weight depends on Source Level
                    });
                }
            } catch (err) {
                console.error('[UserEvent] Failed to queue post like rep:', err.message);
            }
        })());

    } else {
        tasks.push(cacheService.delete(cacheKey));
        tasks.push(activityService.logActivity({
            cid,
            author: { _id: profile._id, username: profile.name, picture: profile.picture, author: profile.author },
            actionType: 'like',
            target: { id: post._id, type: 'post', preview: post.title?.substring(0, 50) + '...' },
            references: { entity: post.entity },
        }));
    }

    await runBackgroundTasks(tasks, 'onPostLiked');
};

exports.onCommentLiked = async ({ req, entity, comment, post, profile }) => {
    const { cid, user } = req;
    const author = user.author; 
    const cacheKey = `cid:${cid}:commentLikes:${comment._id}:structure`;
    const { recordGamificationActivity } = getEnterpriseFunctions();

    const tasks = [
        invalidateSidecar(cid, profile._id),
        cacheService.delete(cacheKey),
        recordGeoActivity(req, 'like'),
        recordGeoActivity(req, 'like', entity),
        recordActivityHit(`activity:likes:${cid}`, 'added', entity),
        recordProfileActivity(cid, author, 'like-given-added', profile._id, new Date()),
    ];

    if (author !== comment.author) {
        const commentId = comment.root || comment._id;
        const replyId = comment.root ? comment._id : null;

        if (recordGamificationActivity && comment.profile_id) {
            tasks.push(
                recordGamificationActivity(cid, comment.profile_id, 'LIKE_RECEIVED', {
                    entityId: entity,
                    commentId: comment._id,
                    fromProfileId: profile._id,
                    isUserRef: true
                })
            );
        }

        tasks.push(
            sendNotificationAndLogActivity({
                cid,
                author,
                entity,
                postId: post._id,
                commentId,
                replyId,
                actionType: 'like',
                notificationType: 'like',
                recipient: comment.author,
                targetPreview: comment.text,
                cacheKeys: []
            })
        );

        // Reputation
        if (comment.profile_id) {
            tasks.push(
                queueReputationEvent({
                    cid,
                    target_profile_id: comment.profile_id,
                    source_profile_id: profile._id,
                    event_type: 'upvote',
                    entity_id: comment._id,
                    source_trust_level: profile.trust?.level || 0
                })
            );
        }
    }

    await runBackgroundTasks(tasks, 'onCommentLiked');
};

exports.onLikeRemoved = async ({ req, entity, targetType, targetId, profile }) => {
    const { cid, user } = req;
    const author = user.author;
    const { recordGamificationActivity } = getEnterpriseFunctions();

    const cacheKey = targetType === 'post' 
        ? `cid:${cid}:postLikes:${entity}:structure`
        : `cid:${cid}:commentLikes:${targetId}:structure`;

    const tasks = [
        invalidateSidecar(cid, profile._id),
        cacheService.delete(cacheKey),
        recordActivityHit(`activity:likes:${cid}`, 'removed', entity),
        recordProfileActivity(cid, author, 'like-given-removed', profile._id, new Date())
    ];

    if (recordGamificationActivity) {
        tasks.push((async () => {
            try {
                let contentProfileId = null;
                let contentAuthor = null;

                if (targetType === 'post') {
                    const post = await Post.findById(targetId).select('author').lean();
                    if (post) {
                        contentAuthor = post.author;
                        const p = await Profile.findOne({ author: post.author, cid }).select('_id');
                        contentProfileId = p?._id;
                    }
                } else if (targetType === 'comment') {
                    const comment = await Comment.findById(targetId).select('author profile_id').lean();
                    contentAuthor = comment?.author;
                    contentProfileId = comment?.profile_id;
                }

                if (contentProfileId && contentAuthor !== author) {
                    await recordGamificationActivity(cid, contentProfileId, 'LIKE_REMOVED', {
                        entityId: entity,
                        targetId: targetId,
                        fromProfileId: profile._id
                    });
                }
            } catch (error) {
                console.warn('[UserEvent] Failed to process gamification unlike:', error.message);
            }
        })());
    }

    await runBackgroundTasks(tasks, 'onLikeRemoved');
};

exports.onBookmarkToggled = async ({ req, entity, post, profile, isAttached }) => {
    const { cid, user } = req;
    const author = user.author;
    const { recordGamificationActivity } = getEnterpriseFunctions();

    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordProfileActivity(cid, author, isAttached ? 'bookmark-added' : 'bookmark-removed', profile._id, new Date())
    ];

    if (isAttached) {
         tasks.push(activityService.logActivity({
            cid,
            author: { _id: profile._id, username: profile.name, picture: profile.picture, author: profile.author },
            actionType: 'bookmark',
            target: { id: post._id, type: 'post', preview: post.title?.substring(0, 50) + '...' },
            references: { entity: post.entity },
        }));

        if (recordGamificationActivity) {
             tasks.push(recordGamificationActivity(cid, profile._id, 'POST_BOOKMARKED', {
                entityId: entity,
                postId: post._id
            }));
        }
    }

    await runBackgroundTasks(tasks, 'onBookmarkToggled');
};

exports.onFollowRequested = async ({ req, targetProfile, currentProfile }) => {
    const { cid, user } = req;
    const author = user.author;
    const profileService = require('./profileService'); 

    const tasks = [
        profileService.deleteProfileCache(cid, currentProfile.author),
        profileService.deleteProfileCache(cid, targetProfile.author),
        sendNotificationAndLogActivity({
            cid, 
            author, 
            actionType: 'follower-request', 
            notificationType: 'follow_request',
            recipient: targetProfile.author, 
            cacheKeys: [],
            targetPreview: targetProfile.name,
            targetId: targetProfile._id
        })
    ];
    await runBackgroundTasks(tasks, 'onFollowRequested');
};

exports.onNewFollower = async ({ req, targetProfile, currentProfile }) => {
    const { cid, user } = req;
    const author = user.author;
    const profileService = require('./profileService');

    const tasks = [
        profileService.deleteProfileCache(cid, currentProfile.author),
        profileService.deleteProfileCache(cid, targetProfile.author),
        sendNotificationAndLogActivity({
            cid, 
            author, 
            actionType: 'follower', 
            notificationType: 'follower',
            recipient: targetProfile.author, 
            cacheKeys: [],
            targetPreview: targetProfile.name,
            targetId: targetProfile._id 
        })
    ];
    await runBackgroundTasks(tasks, 'onNewFollower');
};

exports.onFollowApproved = async ({ req, requestProfile, targetProfile }) => {
    const { cid, user } = req;
    const author = user.author;
    const profileService = require('./profileService');

    const tasks = [
        profileService.deleteProfileCache(cid, targetProfile.author),
        profileService.deleteProfileCache(cid, requestProfile.author),
        sendNotificationAndLogActivity({
            cid, 
            author, 
            actionType: 'follow-approval', 
            notificationType: 'follow_approved',
            recipient: requestProfile.author, 
            cacheKeys: [],
            targetPreview: requestProfile.name,
            targetId: requestProfile._id 
        })
    ];
    await runBackgroundTasks(tasks, 'onFollowApproved');
};

exports.onUserUnfollowed = async ({ req, targetProfile, currentProfile }) => {
    const { cid } = req;
    const profileService = require('./profileService');

    const tasks = [
        profileService.deleteProfileCache(cid, currentProfile.author),
        profileService.deleteProfileCache(cid, targetProfile.author)
    ];
    await runBackgroundTasks(tasks, 'onUserUnfollowed');
};

exports.onFollowRejected = async ({ req, requestProfile, targetProfile }) => {
    const { cid } = req;
    const profileService = require('./profileService');

    const tasks = [
        profileService.deleteProfileCache(cid, targetProfile.author),
        profileService.deleteProfileCache(cid, requestProfile.author)
    ];
    await runBackgroundTasks(tasks, 'onFollowRejected');
};

exports.onPostShared = async ({ req, entity, post, profile }) => {
    const { cid, user } = req;
    const author = user?.author;
    const profileService = require('./profileService');
    const { recordGamificationActivity } = getEnterpriseFunctions();

    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordGeoActivity(req, 'share'),
        recordGeoActivity(req, 'share', entity),
        recordActivityHit(`activity:shares:${cid}`, 'added', entity)
    ];

    if (profile && author) {
        tasks.push(recordProfileActivity(cid, author, 'share-given-added', profile._id, new Date()));
        
        if (recordGamificationActivity) {
            tasks.push(recordGamificationActivity(cid, profile._id, 'POST_SHARED', {
                entityId: entity,
                postId: post._id
            }));
        }

        tasks.push(profileService.deleteProfileCache(cid, author));

        if (author !== post.author) {
            tasks.push(sendNotificationAndLogActivity({
                cid,
                author,
                entity,
                postId: post._id,
                actionType: 'share',
                notificationType: 'share',
                recipient: post.author,
                targetPreview: post.title
            }));
        } else {
            tasks.push(activityService.logActivity({
                cid,
                author: { _id: profile._id, username: profile.name, picture: profile.picture, author: profile.author },
                actionType: 'share',
                target: { id: post._id, type: 'post', preview: post.title?.substring(0, 50) + '...' },
                references: { entity: post.entity },
            }));
        }
    }

    await runBackgroundTasks(tasks, 'onPostShared');
};

exports.onCommentDeleted = async ({ req, commentDoc, profileId }) => {
    const { cid, user } = req;
    const author = user.author;
    const profileService = require('./profileService');
    const { recordGamificationActivity } = getEnterpriseFunctions();
    
    const tasks = [
        invalidateSidecar(cid, profileId),
        profileService.deleteProfileCache(cid, author),
        cacheService.delete(`cid:${cid}:thread:${commentDoc.entity}:limit:${LIMIT_COMMENTS}:last:initial`),
        recordProfileActivity(cid, author, 'comment-deleted', profileId, new Date())
    ];

    if (recordGamificationActivity) {
        tasks.push(recordGamificationActivity(cid, profileId, 'COMMENT_REMOVED', {
            entityId: commentDoc.entity,
            commentId: commentDoc._id
        }));
    }

    if (commentDoc.parent) {
        tasks.push(cacheService.delete(`cid:${cid}:thread:${commentDoc.entity}:${commentDoc.parent}:limit:${LIMIT_COMMENTS}:last:none`));
    }

    const activityType = commentDoc.parent ? 'replies' : 'comments';
    tasks.push(recordActivityHit(`activity:${activityType}:${cid}`, 'deleted', commentDoc.entity));

    await runBackgroundTasks(tasks, 'onCommentDeleted');
};

exports.onSurveyVoted = async ({ req, surveyId, optionId, profile }) => {
    const { cid } = req;
    const { recordGamificationActivity } = getEnterpriseFunctions();
    
    const tasks = [
        invalidateSidecar(cid, profile._id),
        recordGeoActivity(req, 'vote'),
        recordGeoActivity(req, 'vote', surveyId),
        recordActivityHit(`activity:votes:${cid}`, 'added', surveyId)
    ];

    if (profile) {
        const author = req.user?.author;
        tasks.push(recordProfileActivity(cid, author, 'vote-added', profile._id, new Date()));

        if (recordGamificationActivity) {
            tasks.push(recordGamificationActivity(cid, profile._id, 'SURVEY_VOTED', {
                surveyId,
                optionId
            }));
        }

        tasks.push(
            queueReputationEvent({
                cid,
                target_profile_id: profile._id, 
                source_profile_id: null, 
                event_type: 'survey_vote',
                entity_id: surveyId,
                source_trust_level: profile.trust?.level || 0
            })
        );
    }

    await runBackgroundTasks(tasks, 'onSurveyVoted');
};