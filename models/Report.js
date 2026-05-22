/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Generic report model for moderation.
 * @module models/Report
 * @description Replaces Reported with a unified schema capable of tracking
 * reports against any entity type (comment, profile) while preserving full context
 * about both the reporter and the reported party.
 */

'use strict';

const { mongoose } = require('../db');

/**
 * @typedef {Object} ReportEntry
 * @property {mongoose.Types.ObjectId} profile_id  - Profile of the user who submitted this report (reporter).
 * @property {string}                  report_type - Categorisation of the report.
 * @property {string|null}             reason      - Optional free-text detail provided by the reporter.
 * @property {string|null}             source      - Surface from which the report was triggered (e.g. "community", "chat").
 * @property {Date}                    created_at  - Timestamp of the individual report submission.
 */
const ReportEntrySchema = new mongoose.Schema({
    profile_id: {
        type:     mongoose.Schema.Types.ObjectId,
        required: true,
        ref:      'Profile',
    },
    report_type: {
        type:     String,
        required: true,
        enum:     ['spam', 'abuse', 'offensive', 'political', 'other'],
    },
    reason: {
        type:      String,
        trim:      true,
        default:   null,
        maxLength: 500,
    },
    source: {
        type:    String,
        trim:    true,
        default: null,
    },
    created_at: {
        type:    Date,
        default: Date.now,
    },
});

/**
 * @typedef {Object} Report
 * @property {mongoose.Types.ObjectId}      target_id         - The reported entity (_id of a Comment or Profile).
 * @property {string}                        target_type       - Discriminator: "comment" or "profile".
 * @property {mongoose.Types.ObjectId}      reported_profile  - Profile of the user being reported (the accused).
 * @property {mongoose.Types.ObjectId|null} context_id        - Parent context: Post._id when target_type is "comment", null for profiles.
 * @property {ReportEntry[]}                reports           - Array of individual report submissions.
 * @property {string}                        status            - Moderation status: "pending" or "resolved".
 * @property {string|null}                   resolution_reason - Notes added by a moderator upon resolution.
 * @property {Date}                          created_at        - Document creation timestamp.
 * @property {Date}                          updated_at        - Last modification timestamp (auto-updated via pre-save).
 * @property {number}                        report_count      - Virtual: total number of reports on this entity.
 */
const ReportSchema = new mongoose.Schema({
    target_id: {
        type:     mongoose.Schema.Types.ObjectId,
        required: true,
    },
    target_type: {
        type:     String,
        required: true,
        enum:     ['comment', 'profile'],
        index:    true,
    },
    reported_profile: {
        type:     mongoose.Schema.Types.ObjectId,
        required: true,
        ref:      'Profile',
        index:    true,
    },
    context_id: {
        type:    mongoose.Schema.Types.ObjectId,
        default: null,
    },
    reports: [ReportEntrySchema],
    status: {
        type:    String,
        enum:    ['pending', 'resolved'],
        default: 'pending',
        index:   true,
    },
    resolution_reason: {
        type:      String,
        trim:      true,
        default:   null,
        maxLength: 300,
    },
    created_at: {
        type:    Date,
        default: Date.now,
    },
    updated_at: {
        type:    Date,
        default: Date.now,
    },
});

/**
 * Pre-save middleware that refreshes `updated_at` on every write.
 */
ReportSchema.pre('save', function (next) {
    this.updated_at = new Date();
    next();
});

/**
 * Virtual field that returns the total number of individual reports without an extra DB query.
 *
 * @name report_count
 * @memberof ReportSchema
 * @type {number}
 */
ReportSchema.virtual('report_count').get(function () {
    return this.reports.length;
});

/**
 * Unique compound index — one Report document per reported entity.
 * Prevents duplicate aggregation documents for the same target.
 */
ReportSchema.index({ target_id: 1, target_type: 1 }, { unique: true });

module.exports = mongoose.model('Report', ReportSchema);