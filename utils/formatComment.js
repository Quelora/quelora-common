/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// utils/formatComment.js
const formatComment = (comment, profile, currentUser = '', authorLiked = false) => {
    const isEdited = comment.created_at < comment.updated_at;

    const profileIsObject = typeof profile === 'object';
    const author = profileIsObject ? profile.author : profile;
    const profileData = profileIsObject ? profile : {};

    return {
        _id: comment._id,
        profile: profileData, 
        author: author,
        text: comment.text,
        language: comment.language ?? '',
        timestamp: isEdited ? comment.updated_at : comment.created_at,
        likes: comment.likesCount,
        authorLiked: authorLiked,
        repliesCount: comment.repliesCount,
        isEdited: isEdited,
        root: comment.root,
        visible: comment.visible ?? true,
        hasAudio: comment.hasAudio ?? false,
        rankingScore: comment.ranking_score || 0
    };
};
    
module.exports = formatComment;