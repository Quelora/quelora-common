/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// packages/quelora-common/services/pushService.js
const { Queue } = require('bullmq');
const { randomUUID } = require('crypto');
const Profile = require('../models/Profile');
const { getLocalizedMessage } = require('./i18nService');
const { cacheClient } = require('./cacheService');

const notificationQueue = new Queue('notifications', {
  connection: cacheClient,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

const addPushJob = async (cid, author, title, body, data = {}, type = 'default') => {
    const jobId = `notif_${author}_${Date.now()}_${randomUUID()}`;
    
    return notificationQueue.add('send-notification', {
        cid,
        author,
        title,
        body,
        data: { ...data, type }
    }, {
        jobId
    });
};

async function sendPushNotification(cid, author, title, message, data = {}, extra = {}, type = 'default') {
  if (!cid || !author || !title || !message) {
      throw new Error('Author, title, and message are required');
  }
  
  const profile = await Profile.findOne({ author, cid });
  
  if (!profile || !profile.pushSubscriptions?.length) {
      return;
  }

  const localizedTitle = await getLocalizedMessage(title, profile.locale ?? 'en');
  const localizedMessage = await getLocalizedMessage(message, profile.locale ?? 'en', data);

  await addPushJob(cid, author, localizedTitle, localizedMessage, { ...data, ...extra }, type);
}

async function sendPushNotificationsToFollowers(cid, author, title, message, data = {}, extra = {}, type = 'default') {
  if (!cid || !author || !title || !message) {
      throw new Error('Author, title, and message are required');
  }

  const profile = await Profile.findOne({ author, cid });
  if (!profile) return;

  const defaultLocale = profile.locale ?? 'en';
  const localizedTitle = await getLocalizedMessage(title, defaultLocale);
  const localizedMessage = await getLocalizedMessage(message, defaultLocale, data);

  const jobId = `broadcast_${author}_${Date.now()}_${randomUUID()}`;

  await notificationQueue.add('send-notification', {
      cid,
      author,
      title: localizedTitle,
      body: localizedMessage,
      data: { ...data, ...extra },
      type: 'broadcast_followers'
  }, {
      jobId
  });
}

module.exports = {
  notificationQueue,
  addPushJob,
  sendPushNotification,
  sendPushNotificationsToFollowers,
  connection: cacheClient
};