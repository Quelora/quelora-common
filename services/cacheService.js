/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./services/cacheService.js
const Redis = require('ioredis');

const redisUrl = process.env.CACHE_REDIS_URL || process.env.CACHE_URL;

const cacheClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

cacheClient.hIncrBy = cacheClient.hincrby;
cacheClient.hGet = cacheClient.hget;
cacheClient.hSet = cacheClient.hset;
cacheClient.hGetAll = cacheClient.hgetall;
cacheClient.sAdd = cacheClient.sadd;
cacheClient.sIsMember = cacheClient.sismember;
cacheClient.lPush = cacheClient.lpush;
cacheClient.rPush = cacheClient.rpush;
cacheClient.lRange = cacheClient.lrange;
cacheClient.lTrim = cacheClient.ltrim;
cacheClient.lLen = cacheClient.llen;
cacheClient.lPop = cacheClient.lpop;
cacheClient.rPop = cacheClient.rpop;
cacheClient.expire = cacheClient.expire;
cacheClient.del = cacheClient.del;
cacheClient.hDel = cacheClient.hdel;
cacheClient.sCard = cacheClient.scard;
cacheClient.sRem = cacheClient.srem;
cacheClient.getSet = cacheClient.getset;
cacheClient.mGet = cacheClient.mget;
cacheClient.mSet = cacheClient.mset;

cacheClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

cacheClient.on('connect', () => {
  console.log('✅ Connected to Redis (ioredis)');
});

cacheClient.on('ready', () => {
  console.log('✅ Redis client is ready');
});

const cacheService = {
  get: async (key) => {
    try {
      const cachedData = await cacheClient.get(key);
      if (cachedData !== null) {
        return JSON.parse(cachedData);
      }
      return null;
    } catch (error) {
      console.warn('Redis GET failed, continuing without cache', err.message);
      return null; 
    }
  },

  set: async (key, data, ttl = null) => {
    try {
      const serializedData = JSON.stringify(data);
      if (ttl !== null && (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0)) {
        throw new Error('TTL must be a positive integer or null');
      }
      if (ttl) {
        await cacheClient.set(key, serializedData, 'EX', ttl);
      } else {
        await cacheClient.set(key, serializedData);
      }
    } catch (error) {
      console.error('Error saving data to cache:', error);
      throw error;
    }
  },

  delete: async (key) => {
    try {
      await cacheClient.del(key);
    } catch (error) {
      console.error('Error deleting data from cache:', error);
      throw error;
    }
  },

  deleteByPattern: async (pattern) => {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await cacheClient.scan(
          cursor,
          'MATCH', pattern,
          'COUNT', 100
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await cacheClient.del(keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error(`Error deleting keys by pattern "${pattern}":`, error);
      throw error;
    }
  },

  flush: async () => {
    try {
      await cacheClient.flushall();
    } catch (error) {
      console.error('Error flushing cache:', error);
      throw error;
    }
  },

  increment: async (key, ttl = 3600) => {
    try {
      const newValue = await cacheClient.incr(key);
      if (newValue === 1 && ttl) {
        await cacheClient.expire(key, ttl);
      }
      return newValue;
    } catch (error) {
      console.error('Error incrementing cache:', error);
      return null;
    }
  }
};

module.exports = { cacheClient, cacheService };
