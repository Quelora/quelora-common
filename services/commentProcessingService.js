/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('../db');
const crypto = require('crypto');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const { toxicityService } = require('./toxicityService');
const { moderateService } = require('./moderateService');
const { detectLanguage } = require('./languageService');
const { queueReputationEvent } = require('./reputationService');
const { loadOptionalModule } = require('../utils/featureLoader');
const clientConfigService = require('./clientConfigService');

const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || 'es';

const cleanAndValidateText = (text) => {
    if (!text) return null;
    return text.trim()
        .replace(/<[^>]*>?/gm, '')
        .replace(/[^\p{L}\p{N}\p{P}\p{S}\s\u200D\uFE0F]/gu, '');
};

const analyzeCommentToxicity = async (text, language, clientToxicityConfig) => {
    const { isPolite, scores } = await toxicityService(text, language, clientToxicityConfig);
    if (isPolite === null) throw new Error('Error analyzing toxicity');
    const toxicityScoreAvg = scores?.TOXICITY?.summaryScore?.value ?? 0;
    return { isPolite, scores, toxicityScoreAvg };
};

const analyzeCommentModeration = async (cid, text, clientModerationConfig) => {
    const { isRejected, reason } = await moderateService(cid, text, clientModerationConfig);
    if (isRejected === null) throw new Error('Error analyzing moderation');
    return { isRejected, reason };
};

const estimateWebmOpusDuration = (base64String, bitrate = 16000) => {
    const base64Data = base64String.split(',')[1] || base64String;
    const byteLength = base64Data.length * 0.75;
    return byteLength / (bitrate / 8);
};

const validateAudio = async (text, audio, hash, post, clientConfig) => {
    if (!text || !audio || !hash) throw new Error('Text, audio, and hash are required.');
    
    const computedHash = crypto.createHash('sha1').update(audio + text).digest('hex');
    if (computedHash !== hash) throw new Error('Invalid hash: Audio and text do not match.');

    const max_recording_seconds = post.config?.audio?.max_recording_seconds ?? clientConfig?.audio?.max_recording_seconds ?? 60;
    const bitrate = post.config?.audio?.bitrate ?? clientConfig?.audio?.bitrate ?? 16000;
    
    const tolerance = 0.2;
    const estimatedDuration = estimateWebmOpusDuration(audio, bitrate);
    const maxDurationWithTolerance = max_recording_seconds * (1 + tolerance);

    if (estimatedDuration > maxDurationWithTolerance) {
        throw new Error(`Audio duration (${estimatedDuration.toFixed(1)}s) exceeds maximum allowed.`);
    }
    return true;
};

const getGamificationBonuses = async (cid, authorHash) => {
    try {
        const Enterprise = loadOptionalModule('@quelora/enterprise');
        if (!Enterprise || !Enterprise.GamificationInventory) return 0;

        const profile = await Profile.findOne({ author: authorHash, cid }).select('_id');
        if (!profile) return 0;

        const activeBoosts = await Enterprise.GamificationInventory.find({
            cid,
            profile_id: profile._id,
            isActive: true
        }).populate({
            path: 'item_id',
            match: { effectType: 'CHAR_LIMIT_INCREASE' },
            select: 'metadata effectType'
        }).lean();

        let totalBonus = 0;
        activeBoosts.forEach(inv => {
            if (inv.item_id) {
                const val = parseInt(inv.item_id.metadata?.value || 0, 10);
                const qty = inv.quantity || 1;
                totalBonus += (val * qty);
            }
        });
        return totalBonus;
    } catch (e) {
        console.error('Error fetching gamification bonuses:', e);
        return 0;
    }
};

const processCommentLogic = async ({ 
    author, 
    locale = 'es', 
    cid, 
    text, 
    entity, 
    commentId = null, 
    isReply = false, 
    clientConfig = {} 
}) => {
    
    const cleanedText = cleanAndValidateText(text);
    if (!cleanedText) throw new Error(isReply ? 'Reply text is required.' : 'Comment text is required.');

    if (!mongoose.Types.ObjectId.isValid(entity) || (commentId && !mongoose.Types.ObjectId.isValid(commentId))) {
        throw new Error('Invalid entity or comment ID.');
    }

    const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' }).lean();
    if (!post) throw new Error('Post not found.');

    const interaction = post.config?.interaction ?? clientConfig?.interaction ?? {};
    const visibility = post.config?.visibility ?? clientConfig?.visibility ?? 'public';
    const limits = post.config?.limits ?? clientConfig?.limits ?? {};
    const moderation = post.config?.moderation ?? clientConfig?.moderation ?? {};
    const language = post.config?.language ?? clientConfig?.language ?? {};

    if (visibility !== "public") throw new Error('This post is not public.');

    if ((!isReply && interaction.allow_comments === false) || (isReply && interaction.allow_replies === false)) {
        throw new Error(isReply ? 'Replies are not allowed for this post.' : 'Comments are not allowed for this post.');
    }

    const baseLimit = isReply ? (limits.reply_text || 200) : (limits.comment_text || 200);
    const bonusLimit = await getGamificationBonuses(cid, author);
    const totalMaxLimit = baseLimit + bonusLimit;

    if (cleanedText.length > totalMaxLimit) throw new Error(`Text must not exceed ${totalMaxLimit} characters.`);

    let scores = null;
    let toxicityScoreAvg = 0;

    if (moderation.enable_toxicity_filter) {
        const clientToxicityConfig = await clientConfigService.getClientConfig(cid, 'toxicity');
        if (clientToxicityConfig?.enabled && clientToxicityConfig?.apiKey) {
            const commentLanguage = locale.substring(0, 2);
            const toxicity = await analyzeCommentToxicity(cleanedText, commentLanguage, clientToxicityConfig);
            scores = toxicity.scores;
            toxicityScoreAvg = toxicity.toxicityScoreAvg;
            if (!toxicity.isPolite) {
                // Automatic Sanction: If the toxicity is extreme (> 0.90), we punish the user
                if (toxicityScoreAvg > 0.90) {
                    try {
                        const profile = await Profile.findOne({ author, cid }).select('_id');
                        if (profile) {
                            queueReputationEvent({
                                cid,
                                target_profile_id: profile._id,
                                source_profile_id: null, 
                                event_type: 'spam_report',
                                entity_id: post._id,
                                source_trust_level: 5
                            }).catch(err => console.error('Error queuing toxicity penalty:', err.message));
                        }
                    } catch (error) {
                        console.error('Error processing toxicity penalty:', error);
                    }
                }
                throw new Error('Your comment has been blocked due to inappropriate content.');
            }
        }
    }

    if (moderation.enable_content_moderation) {
        const clientModerationConfig = await clientConfigService.getClientConfig(cid, 'moderation');
        if (clientModerationConfig?.enabled && clientModerationConfig?.apiKey) {
            const { isRejected, reason } = await analyzeCommentModeration(cid, cleanedText, clientModerationConfig);
            if (isRejected) throw new Error(reason);
        }
    }

    let defaultLanguage = DEFAULT_LANGUAGE;
    if (language.auto_translate && !locale.startsWith(DEFAULT_LANGUAGE)) {
        defaultLanguage = await detectLanguage(cleanedText);
    }
    defaultLanguage = defaultLanguage.substring(0, 2);

    return { 
        text: cleanedText, 
        defaultLanguage, 
        scores, 
        toxicityScoreAvg, 
        post, 
        author, 
        isReply, 
        commentId 
    };
};

module.exports = {
    processCommentLogic,
    validateAudio,
    cleanAndValidateText
};