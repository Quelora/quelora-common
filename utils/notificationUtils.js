/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: ./utils/notificationUtils.js */
const Profile = require('@quelora/common/models/Profile');
const ProfileFollower = require('@quelora/common/models/ProfileFollower');
const clientConfigService = require('@quelora/common/services/clientConfigService');
const { cacheService, cacheClient } = require('@quelora/common/services/cacheService');
const { ACTIVITY_QUEUE_KEY } = require('@quelora/common/services/activityService');
const { sendPushNotification, sendPushNotificationsToFollowers } = require('../services/pushService');
const { sendEmailNotification, sendEmailBroadcastToFollowers } = require('../services/emailService');
const { aggregateNotification } = require('@quelora/common/services/notificationAggregatorService');

/**
 * Fan-out thresholds to protect latency.
 * Large audiences are delegated to background workers.
 */
const FANOUT_LIMIT_THRESHOLD = 2000;
const PROCESSING_BATCH_SIZE = 200;

/**
 * Builds a client-side hash URL pointing to the related entity.
 */
const buildHashUrl = (siteUrl, type, { entity, commentId, replyId, profileId }) => {
    if (!siteUrl) return null;
    const baseUrl = siteUrl.replace(/\/$/, '');

    switch (type) {
        case 'follower':
        case 'follow':
        case 'follow_request':
        case 'follow_approved':
            return profileId ? `${baseUrl}/#QUELORA-U-${profileId}` : baseUrl;

        case 'reply':
            return (entity && commentId && replyId)
                ? `${baseUrl}/#QUELORA-Q-${entity}-${commentId}-${replyId}`
                : baseUrl;

        case 'comment':
        case 'comment_followers':
        case 'post_mentioned':
            return (entity && commentId)
                ? `${baseUrl}/#QUELORA-Q-${entity}-${commentId}`
                : baseUrl;

        case 'like':
            if (entity && commentId) {
                return replyId
                    ? `${baseUrl}/#QUELORA-L-${entity}-${commentId}-${replyId}`
                    : `${baseUrl}/#QUELORA-L-${entity}-${commentId}`;
            }
            if (entity) {
                return `${baseUrl}/#QUELORA-Q-${entity}`;
            }
            return baseUrl;

        default:
            return baseUrl;
    }
};

/**
 * Maps action types to email CTA localization keys.
 */
const getActionTextKey = (actionType) => {
    if (actionType.includes('follow')) return 'email.action_view_profile';
    if (actionType === 'reply') return 'email.action_view_reply';
    if (actionType === 'comment' || actionType === 'comment_followers') {
        return 'email.action_view_comment';
    }
    if (actionType === 'like') return 'email.action_view_post';
    return 'email.default_action';
};

/**
 * Resolves notification preference keys per action type.
 */
const getSettingKeyForAction = (actionType) => {
    switch (actionType) {
        case 'like': return 'postLikes';
        case 'comment':
        case 'reply':
        case 'comment_followers': return 'comments';
        case 'follower':
        case 'follower-request':
        case 'follow-approval': return 'newFollowers';
        case 'new_post': return 'newPost';
        default: return null;
    }
};

/**
 * Enqueues an activity entry for persistence.
 */
const queueActivityLog = async (activityData, requiresFanout = false) => {
    try {
        await cacheClient.lPush(
            ACTIVITY_QUEUE_KEY,
            JSON.stringify({
                cid: activityData.cid,
                author: activityData.author,
                actionType: activityData.actionType,
                target: activityData.target,
                targetProfile: activityData.targetProfile,
                references: activityData.references,
                timestamp: new Date(),
                requiresFanout
            })
        );
    } catch (error) {
        console.error(error);
    }
};

/**
 * Broadcasts public activities to followers using Redis Pub/Sub.
 * Large audiences are delegated to background workers.
 * * REFACTOR (v4.0.0): Now publishes to segmented `notifications:cid:{cid}` channel.
 */
const broadcastActivityToFollowers = async (
    cid,
    actorProfile,
    actionType,
    payloadTemplate,
    excludeUserId = null
) => {
    try {
        const count = actorProfile.followersCount || 0;
        if (count === 0) return;
        if (count > FANOUT_LIMIT_THRESHOLD) return { delegated: true };

        const followersStream = ProfileFollower.find({ profile_id: actorProfile._id })
            .select('follower_id')
            .lean()
            .cursor();

        const ssePayload = {
            ...payloadTemplate,
            type: 'activity',
            actionType,
            isFeed: true
        };

        const processBatch = async (followerIds) => {
            if (!followerIds.length) return;

            const targetProfiles = await Profile.find({ _id: { $in: followerIds } })
                .select('author')
                .lean();

            const pipeline = cacheClient.pipeline();
            let operationsAdded = 0;

            for (const targetProfile of targetProfiles) {
                if (!targetProfile?.author) continue;
                if (
                    targetProfile.author === actorProfile.author ||
                    targetProfile.author === excludeUserId
                ) continue;

                // CHANGED: Use segmented channel per CID
                pipeline.publish(
                    `notifications:cid:${cid}`,
                    JSON.stringify({
                        targetUserId: targetProfile.author,
                        payload: ssePayload
                    })
                );
                operationsAdded++;
            }

            if (operationsAdded > 0) {
                await pipeline.exec();
            }
        };

        let batchIds = [];

        for await (const follow of followersStream) {
            batchIds.push(follow.follower_id);
            if (batchIds.length >= PROCESSING_BATCH_SIZE) {
                await processBatch(batchIds);
                batchIds = [];
            }
        }

        if (batchIds.length > 0) {
            await processBatch(batchIds);
        }

        return { delegated: false };
    } catch (error) {
        console.error('[SSE] Broadcast Error:', error);
        return { delegated: false };
    }
};

/**
 * Main orchestration entry point for notifications and activity logging.
 */
const sendNotificationAndLogActivity = async ({
    cid,
    author,
    entity,
    postId,
    commentId,
    replyId = null,
    actionType,
    notificationType,
    recipient = null,
    targetPreview = null,
    targetId = null,
    cacheKeys = []
}) => {
    const profileService = require('@quelora/common/services/profileService');

    const [profile, siteUrl] = await Promise.all([
        Profile.findOne({ author, cid })
            .select('author name given_name family_name picture locale created_at _id followersCount'),
        clientConfigService.getClientConfig(cid, 'siteUrl')
    ]);

    if (!profile) throw new Error('Profile not found.');

    let recipientProfile = null;
    if (recipient) {
        recipientProfile = await Profile.findOne({ author: recipient, cid })
            .select('_id settings.notifications');
    }

    const finalTargetId = targetId || recipientProfile?._id || profile._id;
    const targetAuthorString = recipient || profile.author;

    const targetUrl = buildHashUrl(siteUrl, actionType, {
        entity: entity || postId,
        commentId,
        replyId,
        profileId: actionType.includes('follow') ? finalTargetId : profile._id
    });

    const references = {
        entity,
        commentId,
        ...(replyId && { replyId }),
        ...(actionType.includes('follow') && { profileId: finalTargetId })
    };

    const extraData = {
        ...references,
        ...(actionType.includes('follow') ? { icon: profile.picture } : {})
    };

    const baseSsePayload = {
        actor: {
            name: profile.name,
            picture: profile.picture,
            author: profile.author,
            username: profile.name
        },
        preview: targetPreview,
        link: targetUrl,
        entityId: entity || postId,
        createdAt: new Date(),
        extra: extraData
    };

    const PUBLIC_FEED_ACTIONS = ['comment', 'reply', 'like', 'share', 'vote', 'new_post'];
    let fanoutDelegated = false;

    if (PUBLIC_FEED_ACTIONS.includes(actionType)) {
        const result = await broadcastActivityToFollowers(
            cid,
            profile,
            actionType,
            baseSsePayload,
            recipient
        );
        fanoutDelegated = result?.delegated || false;
    }

    const promises = [];

    promises.push(
        queueActivityLog({
            cid,
            author: {
                _id: profile._id,
                username: profile.name,
                picture: profile.picture,
                author: profile.author
            },
            actionType,
            target: {
                type: actionType === 'comment'
                    ? 'post'
                    : actionType.includes('follow')
                        ? 'profile'
                        : actionType,
                id: finalTargetId,
                preview: targetPreview
                    ? targetPreview.length > 50
                        ? `${targetPreview.substring(0, 50)}...`
                        : targetPreview
                    : '',
                author: targetAuthorString
            },
            targetProfile: (recipient || targetId) ? { _id: finalTargetId } : undefined,
            references
        }, fanoutDelegated)
    );

    const templateVariableKey = actionType === 'reply' ? 'comment' : 'post';

    if (recipient) {
        const userPrefs = recipientProfile?.settings?.notifications || {};
        const settingKey = getSettingKeyForAction(actionType);
        const isEventTypeEnabled = settingKey ? userPrefs[settingKey] !== false : true;

        if (isEventTypeEnabled) {
            const AGGREGABLE_ACTIONS = ['like', 'share'];

            if (AGGREGABLE_ACTIONS.includes(actionType)) {
                promises.push(
                    aggregateNotification({
                        cid,
                        recipientId: finalTargetId,
                        actorId: profile._id,
                        entityId: entity || postId,
                        actionType,
                        preview: targetPreview,
                        references
                    })
                );
            } else {
                // CHANGED: Use segmented channel per CID
                promises.push(
                    cacheClient.publish(
                        `notifications:cid:${cid}`,
                        JSON.stringify({
                            targetUserId: recipient,
                            payload: {
                                ...baseSsePayload,
                                type: notificationType,
                                isNotification: true
                            }
                        })
                    ).catch(() => {})
                );

                if (userPrefs.push !== false) {
                    promises.push(
                        sendPushNotification(
                            cid,
                            recipient,
                            `${notificationType}.title`,
                            `${notificationType}.message`,
                            {
                                name: profile.name,
                                [templateVariableKey]: targetPreview
                            },
                            extraData,
                            notificationType
                        )
                    );
                }

                if (userPrefs.email !== false) {
                    promises.push(
                        sendEmailNotification(
                            cid,
                            recipient,
                            `${notificationType}.title`,
                            `${notificationType}.message`,
                            {
                                name: profile.name,
                                [templateVariableKey]: targetPreview
                            },
                            {
                                actionUrl: targetUrl,
                                actionTextKey: getActionTextKey(actionType)
                            }
                        )
                    );
                }
            }
        }
    } else if (actionType !== 'like') {
        const notificationData = {
            name: profile.name,
            [templateVariableKey]: targetPreview
        };

        promises.push(
            sendPushNotificationsToFollowers(
                cid,
                author,
                `${notificationType}.title`,
                `${notificationType}.message`,
                notificationData,
                extraData,
                notificationType
            )
        );

        promises.push(
            sendEmailBroadcastToFollowers(
                cid,
                author,
                `${notificationType}.title`,
                `${notificationType}.message`,
                notificationData,
                {
                    actionUrl: targetUrl,
                    actionTextKey: getActionTextKey(actionType)
                }
            )
        );
    }

    promises.push(profileService.deleteProfileCache(cid, author));
    cacheKeys.forEach(key => promises.push(cacheService.delete(key)));

    await Promise.allSettled(promises);
};

module.exports = { sendNotificationAndLogActivity };