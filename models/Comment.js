/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: models/Comment.js
const { mongoose } = require('../db');

const commentSchema = new mongoose.Schema({
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        required: true
    },
    entity: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
        default: null,
        index: true
    },
    root: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
        default: null,
        index: true
    },
    profile_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        required: true,
    },
    author: {
        type: String,
        required: true,
        unique: false
    },
    text: {
        type: String,
        required: true,
        trim: true
    },
    reference: {
        type: String,
        required: false,
        unique: false,
        index: true
    },
    language: {
        type: String,
        required: false,
        default: 'es'
    },
    repliesCount: {
        type: Number,
        default: 0
    },
    likesCount: {
        type: Number,
        default: 0
    },
    visible: {
        type: Boolean,
        default: true
    },
    trust_snapshot: {
        level: { type: Number, default: 1 },
        initial_score: { type: Number, default: 0 }
    },
    translates: [{
        language: {
            type: String,
            required: true
        },
        text: {
            type: String,
            required: true
        },
        created_at: {
            type: Date,
            default: Date.now
        }
    }],
    hasAudio: {
        type: Boolean,
        default: false
    },
    ranking_score: { type: Number, default: 0, index: true },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    },
});

commentSchema.statics = {
    async incrementLikes(commentId) {
        return this.findByIdAndUpdate(
            commentId,
            { $inc: { likesCount: 1 } },
            { new: true }
        );
    },

    async decrementLikes(commentId) {
        return this.findByIdAndUpdate(
            commentId,
            { $inc: { likesCount: -1 } },
            { new: true }
        );
    },

    async incrementReplies(commentId) {
        return this.findByIdAndUpdate(
            commentId,
            { $inc: { repliesCount: 1 } },
            { new: true }
        );
    },

    async decrementReplies(commentId) {
        return this.findByIdAndUpdate(
            commentId,
            { $inc: { repliesCount: -1 } },
            { new: true }
        );
    },

    async hide(commentId) {
        const comment = await this.findById(commentId);
        if (!comment) {
            throw new Error('Comment not found');
        }

        if (comment.visible === false) {
            return comment;
        }

        if (comment.parent) {
            await this.decrementReplies(comment.parent);
        }

        comment.visible = false;
        comment.updated_at = Date.now();

        await comment.save();
        return comment;
    },

    async unhide(commentId) {
        const comment = await this.findById(commentId);
        if (!comment) {
            throw new Error('Comment not found');
        }

        if (comment.visible === true) {
            return comment;
        }

        if (comment.parent) {
            const parent = await this.findById(comment.parent);
            if (parent) {
                await this.incrementReplies(comment.parent);
            }
        }

        comment.visible = true;
        comment.updated_at = Date.now();

        await comment.save();
        return comment;
    }
};

commentSchema.index({ post: 1 });
commentSchema.index({ profile_id: 1 });
commentSchema.index({ author: 1 });
commentSchema.index({ created_at: -1 });
commentSchema.index({ ranking_score: -1, _id: -1 });
commentSchema.index({ post: 1, parent: 1, _id: -1 });
commentSchema.index({ profile_id: 1, created_at: -1 });

commentSchema.index(
  { text: "text" }, 
  {
    name: "textIndex_default",
    default_language: "english",
    language_override: "__lang"
  }
);

module.exports = mongoose.model('Comment', commentSchema);