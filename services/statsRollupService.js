/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const ProfileStats = require('../models/ProfileStats');
const ProfileStatsDaily = require('../models/ProfileStatsDaily');

async function runDailyRollup(startDate, endDate) {
    console.log(`[StatsRollup] Starting daily roll-up from ${startDate.toISOString()} to ${endDate.toISOString()}...`);

    const pipeline = [
        {
            $match: {
                date: {
                    $gte: startDate,
                    $lt: endDate
                }
            }
        },
        {
            $group: {
                _id: {
                    cid: "$cid",
                    profileId: "$profileId",
                    author: "$author",
                    date: {
                        $dateFromParts: {
                            'year': { $year: { date: "$date", timezone: "UTC" } },
                            'month': { $month: { date: "$date", timezone: "UTC" } },
                            'day': { $dayOfMonth: { date: "$date", timezone: "UTC" } },
                            'timezone': "UTC"
                        }
                    }
                },
                commentsAdded: { $sum: "$commentsAdded" },
                repliesAdded: { $sum: "$repliesAdded" },
                likesGiven: { $sum: "$likesGiven" },
                sharesGiven: { $sum: "$sharesGiven" },
                likesReceived: { $sum: "$likesReceived" },
                repliesReceived: { $sum: "$repliesReceived" },
                postsViewed: { $sum: "$postsViewed" },
                toxicityScoreAvg: { $avg: "$toxicityScoreAvg" } 
            }
        },
        {
            $project: {
                _id: 0,
                cid: "$_id.cid",
                profileId: "$_id.profileId",
                author: "$_id.author",
                date: "$_id.date",
                commentsAdded: "$commentsAdded",
                repliesAdded: "$repliesAdded",
                likesGiven: "$likesGiven",
                sharesGiven: "$sharesGiven",
                likesReceived: "$likesReceived",
                repliesReceived: "$repliesReceived",
                postsViewed: "$postsViewed",
                toxicityScoreAvg: "$toxicityScoreAvg",
                aggregationType: "daily"
            }
        },
        {
            $merge: {
                into: ProfileStatsDaily.collection.name,
                on: ["cid", "profileId", "date"],
                whenMatched: "replace",
                whenNotMatched: "insert"
            }
        }
    ];

    await ProfileStats.aggregate(pipeline).allowDiskUse(true);

    console.log(`[StatsRollup] Daily roll-up completed for the range.`);
}

module.exports = { runDailyRollup };
