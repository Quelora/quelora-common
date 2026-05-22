/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-common/infrastructure/bullmq.js
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.CACHE_REDIS_URL || process.env.CACHE_URL;

/**
 * Base IORedis connection options for BullMQ.
 * maxRetriesPerRequest: null is mandatory — BullMQ workers use
 * blocking commands that must not time out on retries.
 */
const connectionOptions = {
    maxRetriesPerRequest: null,
    enableOfflineQueue:   false,
};

/**
 * Singleton producer connection shared across all Queue instances.
 * Prevents opening a new TCP connection for every createQueue() call.
 * Producers use non-blocking commands and can safely share one connection.
 */
let sharedProducerConnection;

const getProducerConnection = () => {
    if (!sharedProducerConnection) {
        sharedProducerConnection = new IORedis(redisUrl, connectionOptions);
    }
    return sharedProducerConnection;
};

/**
 * Creates a BullMQ Queue instance (producer side).
 * Use this in the API, scheduler, or any code that dispatches jobs.
 *
 * @param {string} name - Queue name. Use a constant from QUEUES.
 * @param {object} [options] - Optional BullMQ Queue options to override defaults.
 * @returns {Queue}
 */
const createQueue = (name, options = {}) => {
    return new Queue(name, {
        connection: getProducerConnection(),
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail:     500,
            attempts:         3,
            backoff: {
                type:  'exponential',
                delay: 1000,
            },
        },
        ...options,
    });
};

/**
 * Creates a BullMQ Worker instance (consumer side).
 * Each worker requires its own dedicated blocking Redis connection —
 * it cannot share the producer connection.
 *
 * @param {string}   name      - Queue name to listen on. Use a constant from QUEUES.
 * @param {function} processor - Async function that receives a BullMQ Job and processes it.
 * @param {object}   [options] - Optional BullMQ Worker options (concurrency, etc.).
 * @returns {Worker}
 */
const createWorker = (name, processor, options = {}) => {
    return new Worker(name, processor, {
        connection:   new IORedis(redisUrl, connectionOptions),
        concurrency:  options.concurrency || 1,
        lockDuration: 30000,
        ...options,
    });
};

module.exports = { createQueue, createWorker };