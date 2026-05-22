/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/utils/rankingUtils.js */
/**
 * @file rankingUtils.js
 * @description Shared logic for calculating ranking scores (Smart Ranking / Hot Algorithm).
 * Centralizes the formula used by both the Worker (Gravity Decay) and API (Cold Start).
 */

/**
 * Calculates the 'Hot' score based on engagement signals and time decay (Gravity).
 * Formula: (Signal) / (Gravity)
 * * Signal = (Likes * 1.5) + (Replies * 2) + Log10(TrustScore + 1)
 * Gravity = (HoursElapsed + 2) ^ 1.8
 * * @param {Object} comment - The comment document (must include created_at, likesCount, repliesCount).
 * @param {Object} [comment.trust_snapshot] - Snapshot of author trust (level, initial_score OR score).
 * @param {Date} [now=new Date()] - Reference time for decay calculation.
 * @returns {number} The calculated score.
 */
const calculateHotScore = (comment, now = new Date()) => {
    // 1. Extract Signals
    const likes = comment.likesCount || 0;
    const replies = comment.repliesCount || 0;
    
    // ROBUST EXTRACTION: Check for 'initial_score' (Comment Model) AND 'score' (Profile Model / Raw Input)
    // This fixes the Cold Start 0 issue if the input object mapping is slighty off.
    let trustScore = 0;
    if (comment.trust_snapshot) {
        if (typeof comment.trust_snapshot.initial_score === 'number') {
            trustScore = comment.trust_snapshot.initial_score;
        } else if (typeof comment.trust_snapshot.score === 'number') {
            trustScore = comment.trust_snapshot.score;
        }
    }

    // 2. Calculate Signal Strength
    // Logarithmic trust prevents high-reputation users from breaking the scale, 
    // but ensures they don't start at 0.
    const signal = (likes * 1.5) + 
                   (replies * 2) + 
                   Math.log10(Math.max(trustScore, 0) + 1);

    // 3. Calculate Gravity (Time Decay)
    const createdDate = new Date(comment.created_at);
    // Safety check for invalid dates
    if (isNaN(createdDate.getTime())) return 0;

    const msPerHour = 3600000;
    const hoursElapsed = Math.max(0, (now - createdDate) / msPerHour);
    
    // HackerNews style gravity: (t + 2)^G
    const gravity = Math.pow(hoursElapsed + 2, 1.8);

    // 4. Final Score
    return signal / gravity;
};

module.exports = { calculateHotScore };