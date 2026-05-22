/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { Queue } = require('bullmq');
const { randomUUID } = require('crypto');
const Profile = require('../models/Profile');
const { getLocalizedMessage } = require('./i18nService');
const { cacheClient } = require('./cacheService');

const notificationTemplate = require('../templates/emails/notificationTemplate');

const emailQueue = new Queue('emails', {
  connection: cacheClient,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 5000, 
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

const addEmailJob = async (cid, author, subject, body, to = null, options = {}) => {
  const safeAuthor = author || 'guest';
  const jobId = `email-${cid}-${safeAuthor}-${Date.now()}-${randomUUID()}`;
  
  return emailQueue.add('send-email', {
    cid, author, subject, body, to,
    type: options.type || 'general',
    force: options.force || false,
    data: options.data || {} 
  }, { jobId });
};

/**
 * Helper to construct the full HTML body
 */
const buildHtmlBody = async (title, message, locale, options = {}) => {
    const { actionUrl, actionTextKey } = options;
    
    let actionText = null;
    if (actionTextKey) {
        actionText = await getLocalizedMessage(actionTextKey, locale);
    }

    return notificationTemplate({
        title,
        body: message,
        actionUrl,
        actionText,
        language: locale
    });
};

const sendEmailNotification = async (cid, recipientAuthor, subjectKey, messageKey, data = {}, emailOptions = {}) => {
    try {
        const profile = await Profile.findOne({ author: recipientAuthor, cid }).select('locale email');
        if (!profile || !profile.email) return;

        const locale = profile.locale || 'en';

        const subject = await getLocalizedMessage(subjectKey, locale, data);
        const message = await getLocalizedMessage(messageKey, locale, data);
        const htmlBody = await buildHtmlBody(subject, message, locale, emailOptions);

        await addEmailJob(cid, recipientAuthor, subject, htmlBody, profile.email, {
            type: 'notification'
        });
    } catch (error) {
        console.error('Error queuing email notification:', error);
    }
};

const sendEmailBroadcastToFollowers = async (cid, author, subjectKey, messageKey, data = {}, emailOptions = {}) => {
    try {
        const profile = await Profile.findOne({ author, cid }).select('locale');
        
       // Broadcast uses the author's language or default for performance
        const locale = profile?.locale || 'en';

        const subject = await getLocalizedMessage(subjectKey, locale, data);
        const message = await getLocalizedMessage(messageKey, locale, data);

        const htmlBody = await buildHtmlBody(subject, message, locale, emailOptions);

        await addEmailJob(cid, author, subject, htmlBody, null, {
            type: 'broadcast_followers'
        });
    } catch (error) {
        console.error('Error queuing email broadcast:', error);
    }
};

module.exports = {
  emailQueue,
  addEmailJob,
  sendEmailNotification,
  sendEmailBroadcastToFollowers,
  connection: cacheClient
};