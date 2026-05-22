/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/activityService.js */
const { cacheClient } = require('./cacheService');

const getActivityQueueKey = (cid) => `queue:activity:events:${cid}`;

const queueActivity = async (cid, activityData) => {
    try {
        const queueKey = getActivityQueueKey(cid);
        const payload = JSON.stringify({
            ...activityData,
            timestamp: Date.now()
        });
        await cacheClient.lPush(queueKey, payload);
    } catch (error) {
        console.error('Redis Activity Queue Error:', error);
    }
};

const logActivity = async ({ cid, author, actionType, target, targetProfile, references = {} }) => {
  try {
    if (!author?._id || !cid) return false;

    const activityPayload = {
      cid,
      author: {
        _id: author._id,
        picture: author.picture,
        username: author.username,
        author: author.author
      },
      actionType,
      target,
      targetProfile: targetProfile ? { _id: targetProfile._id } : null,
      references
    };

    await queueActivity(cid, activityPayload);
    return true; 
    
  } catch (error) {
    console.error("❌ Error queuing activity:", error.message);
    return false;
  }
};

module.exports = {
  logActivity,
  getActivityQueueKey 
};