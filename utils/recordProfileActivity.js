/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./utils/recordProfileActivity.js
const { cacheClient } = require('../services/cacheService');

/**
 * Registra un hit de actividad desagregada para un perfil en Redis.
 * Esta actividad se consolida más tarde en el ProfileStats Cron Job (horario).
 * @param {string} cid - ID del cliente
 * @param {string} author - ID del autor (string)
 * @param {string} action - Tipo de acción (e.g., 'comment-added')
 * @param {string} profileId - ObjectId del Profile
 * @param {Date} [timestamp=null] - Marca de tiempo para historial (usado en seeding/jobs)
 * @param {Object} [extraData={}] - Datos adicionales a incluir (e.g., {toxicityScore: 0.5})
 */
const recordProfileActivity = async (cid, author, action, profileId, timestamp = null, extraData = {}) => {
    if (!cid || !author || !profileId) return;

    const date = timestamp ? new Date(timestamp) : new Date();
    const pad = (num) => num.toString().padStart(2, '0');
    
    const yyyymmddhh = date.getUTCFullYear() + 
                       pad(date.getUTCMonth() + 1) + 
                       pad(date.getUTCDate()) + 
                       pad(date.getUTCHours());
    
    const fullKey = `activity:profile:${cid}:${profileId}:${yyyymmddhh}`;

    const eventData = JSON.stringify({ 
        author, 
        action, 
        timestamp: date.toISOString(),
        ...extraData
    });

    await cacheClient.lPush(fullKey, eventData);
};

module.exports = { recordProfileActivity };