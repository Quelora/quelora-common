/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-common/services/notificationAggregatorService.js */
const { Queue } = require('bullmq');
const { cacheClient } = require('./cacheService');
const Profile = require('../models/Profile');

/**
 * BullMQ Queue for notification aggregation.
 */
const aggregationQueue = new Queue('aggregation', {
  connection: cacheClient,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

const AGGREGATION_WINDOW_MS = 1 * 60 * 1000;
const REDIS_TTL_SECONDS = (AGGREGATION_WINDOW_MS / 1000) + 600;

/**
 * Aggregates notifications to prevent spam and publishes real-time events.
 * * REFACTOR (v4.0.0):
 * - Isolated Pub/Sub via notifications:cid:${cid}.
 * - Enforces Tenant isolation at the transport layer.
 * * @param {Object} params - Aggregation parameters.
 * @param {string} params.cid - Client ID (Tenant).
 * @param {string} params.recipientId - ID of the user receiving the notification.
 * @param {string} params.actorId - ID of the user performing the action.
 * @param {string} params.entityId - ID of the related entity (post, comment, etc).
 * @param {string} params.actionType - Type of action (like, share, etc).
 * @param {string} [params.preview] - Short text preview.
 * @param {Object} [params.references] - Additional metadata.
 * @param {number} [params.value] - Numeric value for XP/Coins.
 */
const aggregateNotification = async ({
  cid,
  recipientId,
  actorId,
  entityId,
  actionType,
  preview,
  references,
  value = 0
}) => {

  let actorName = 'Someone';
  let actorPic = null;

  if (actorId) {
      const actorProfile = await Profile.findById(actorId).select('name given_name picture');
      if (actorProfile) {
          actorName = actorProfile.given_name || actorProfile.name;
          actorPic = actorProfile.picture;
      }
  }

  // --- 1. Real-time Event Bridge (Fire and Forget) ---
  // REFACTORED: Now uses segmented channel notifications:cid:${cid}
  if (actionType !== 'XP_EARNED' && actionType !== 'COIN_EARNED') {
      try {
          const ssePayload = JSON.stringify({
              targetUserId: recipientId,
              payload: {
                  type: 'notification',
                  data: {
                      cid,
                      actionType,
                      actor: { name: actorName, picture: actorPic },
                      preview: preview || '',
                      entityId,
                      references,
                      timestamp: new Date()
                  }
              }
          });
          
          const channel = `notifications:cid:${cid}`;
          cacheClient.publish(channel, ssePayload).catch(err => 
              console.error(`[Aggregator] Redis Publish Error on ${channel}:`, err.message)
          );
      } catch (err) {
          console.error('[Aggregator] Failed to construct SSE payload:', err.message);
      }
  }

  // --- 2. Aggregation Logic (Redis Buffer) ---
  const bufferKey = `notif_buffer_${cid}_${recipientId}_${actionType}_${entityId}`;

  const pipeline = cacheClient.pipeline();
  
  if (actorId) {
      pipeline.sadd(`${bufferKey}:unique_ids`, actorId.toString());
      pipeline.expire(`${bufferKey}:unique_ids`, REDIS_TTL_SECONDS);
  } else {
      pipeline.incr(`${bufferKey}:count`);
      pipeline.expire(`${bufferKey}:count`, REDIS_TTL_SECONDS);
  }

  if (value > 0) {
      pipeline.incrbyfloat(`${bufferKey}:valueSum`, value);
      pipeline.expire(`${bufferKey}:valueSum`, REDIS_TTL_SECONDS);
  } else {
      if (actorName) {
          pipeline.lrem(`${bufferKey}:actors`, 0, actorName);
          pipeline.lpush(`${bufferKey}:actors`, actorName);
          pipeline.ltrim(`${bufferKey}:actors`, 0, 4);
          pipeline.expire(`${bufferKey}:actors`, REDIS_TTL_SECONDS);
      }
  }

  pipeline.hset(`${bufferKey}:meta`, {
    cid,
    recipientId: recipientId.toString(),
    entityId: entityId ? entityId.toString() : 'general',
    actionType,
    preview: preview || '',
    references: JSON.stringify(references || {})
  });
  pipeline.expire(`${bufferKey}:meta`, REDIS_TTL_SECONDS);
  
  await pipeline.exec();

  // --- 3. Schedule Processing Job ---
  const jobId = `aggr_job_${cid}_${recipientId}_${actionType}_${entityId}`;

  try {
    await aggregationQueue.add('flush-aggregation', {
      bufferKey
    }, {
      jobId,
      delay: AGGREGATION_WINDOW_MS
    });

  } catch (error) {
    // Ignore duplicate job errors
  }
};

module.exports = {
  aggregateNotification,
  aggregationQueue
};