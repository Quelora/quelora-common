/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const Comment = require('../models/Comment');
const Post = require('../models/Post');

// Regex to identify emojis across various unicode ranges
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;

/**
 * Calculates the Shannon entropy of a string.
 * High entropy implies varied vocabulary and complex structure.
 * Low entropy implies repetition (e.g., "hahahahaha").
 * * @param {string} str - The text to analyze
 * @returns {number} - Entropy value
 */
const calculateEntropy = (str) => {
    if (!str) return 0;
    const len = str.length;
    const frequencies = {};

    for (let i = 0; i < len; i++) {
        const char = str[i];
        frequencies[char] = (frequencies[char] || 0) + 1;
    }

    return Object.values(frequencies)
        .reduce((sum, f) => {
            const p = f / len;
            return sum - p * Math.log2(p);
        }, 0);
};

/**
 * pure function: Calculates a quality score (0.01 to 1.0) for a single text.
 * * @param {string} text - The content text
 * @returns {number} - Quality factor
 */
const calculateTextQuality = (text) => {
    if (!text || typeof text !== 'string') return 0;
    
    const trimmed = text.trim();
    const length = trimmed.length;

    // 1. Minimum length penalty
    if (length === 0) return 0;
    if (length < 4) return 0.05; // Extremely short texts are penalized

    // 2. Emoji Density Check (Spam prevention)
    const emojisMatch = trimmed.match(EMOJI_REGEX);
    const emojiCount = emojisMatch ? emojisMatch.length : 0;
    
    // If text is short and mostly emojis, heavy penalty
    if (length < 20 && emojiCount > 0 && (emojiCount / length) > 0.3) {
        return 0.1; 
    }

    // 3. Calculate Entropy
    const entropy = calculateEntropy(trimmed.toLowerCase());

    // 4. Base Score Calculation
    let score = 0.5; // Starting base

    // Bonus: High entropy (rich text)
    if (entropy > 3.0) {
        score += 0.3;
    } 
    // Penalty: Low entropy (repetition like "lololol")
    else if (entropy < 1.5 && length > 10) {
        score -= 0.3; 
    }

    // Bonus: Good length (substantial contribution)
    if (length > 30 && length < 500) {
        score += 0.2;
    }

    // Bonus: Structure (Capitalization and Punctuation)
    // Checks if starts with uppercase and ends with punctuation
    if (/[A-Z]/.test(trimmed[0]) && /[.?!]$/.test(trimmed)) {
        score += 0.1;
    }

    // 5. Clamp result between 0.01 and 1.0
    return Math.max(0.01, Math.min(score, 1.0));
};

/**
 * Audits recent content for a profile to generate a reputation multiplier.
 * Used to detect "farming" behavior when completing quests like "Comment 3 times".
 * * @param {string} cid - Client ID
 * @param {string|ObjectId} profileId - The internal Profile ObjectId
 * @param {string} type - Content type: 'COMMENT' or 'POST'
 * @param {number} limit - How many recent items to check (usually matches quest target)
 * @returns {Promise<number>} - Average quality factor (0.0 - 1.0)
 */
const auditContentQuality = async (cid, profileId, type = 'COMMENT', limit = 5) => {
    try {
        let items = [];
        // Look back 24 hours to find the content relevant to the quest
        const sinceDate = new Date();
        sinceDate.setHours(sinceDate.getHours() - 24);

        if (type === 'COMMENT' || type === 'REPLY') {
            // Fetch recent comments by this profile
            items = await Comment.find({
                profile_id: profileId, // Using the ObjectId reference
                created_at: { $gte: sinceDate }
            })
            .sort({ created_at: -1 })
            .limit(limit)
            .select('text visible')
            .lean();
        } 
        else if (type === 'POST') {
             // Fetch recent posts via the entity lookup or profile reference
             // Note: Post model usually links via Entity, but for this audit we assume
             // we can find posts by this author/entity context if needed.
             // If Post model doesn't store profile_id directly, we might need to join via Entity
             // For now, assuming specific implementation or limited scope to Comments.
             // Placeholder for Post implementation:
             /*
             items = await Post.find({
                 // logic depends on how Post links to Profile (usually via Entity -> Profile)
                 created_at: { $gte: sinceDate }
             }).limit(limit).select('description title');
             */
        }

        if (!items || items.length === 0) {
            return 0; // No content found to audit
        }

        let totalScore = 0;
        let validItems = 0;

        for (const item of items) {
            // If content was hidden (moderated/deleted), it contributes 0 quality
            if (item.visible === false) {
                validItems++; // It counts as an attempt, but score is 0
                continue; 
            }
            
            // For posts, we might combine title + description
            const textToAnalyze = item.text || `${item.title || ''} ${item.description || ''}`;
            totalScore += calculateTextQuality(textToAnalyze);
            validItems++;
        }

        if (validItems === 0) return 0;
        
        // Return average score formatted to 2 decimals
        return Number((totalScore / validItems).toFixed(2));

    } catch (error) {
        console.error(`[QualityAudit] Error auditing ${type} for ${profileId}:`, error.message);
        return 0.1; // Fail safe: return low score on error to prevent exploit
    }
};

module.exports = { 
    calculateTextQuality, 
    auditContentQuality 
};