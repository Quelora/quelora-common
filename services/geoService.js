/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Client = require('@quelora/common/models/Client');
const extractGeoData = require('@quelora/common/middlewares/extractGeoDataMiddleware');

const SHARED_CACHE_DIR = path.join(process.cwd(), 'data', 'geoip_cache');
const activeDownloads = new Map();

class GeoService {
    constructor() {
        this._initCacheDir();
    }

    _initCacheDir() {
        if (!fs.existsSync(SHARED_CACHE_DIR)) {
            fs.mkdirSync(SHARED_CACHE_DIR, { recursive: true });
        }
    }

    cleanup() {
        try {
            if (fs.existsSync(SHARED_CACHE_DIR)) {
                fs.rmSync(SHARED_CACHE_DIR, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('[GeoService] Warning: Failed to clean up cache:', error.message);
        }
    }

    async updateAllClients(force = false) {
        this._initCacheDir();

        try {
            const clients = await Client.find({
                'config.geolocation.enabled': true,
                'config.geolocation.backend.enableCron': true
            });

            for (const client of clients) {
                try {
                    const config = client.decryptConf();
                    const geoConfig = config.geolocation.backend;
                    await this.updateProvider(client.cid, geoConfig, force);
                } catch (err) {
                    console.error(`[GeoService] Error processing client ${client.cid}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[GeoService] Critical error in updateAllClients:', error);
        } finally {
            this.cleanup();
        }
    }

    async updateProvider(cid, geoConfig, force = false) {
        const { provider } = geoConfig;

        switch (provider) {
            case 'maxmind':
                await this._processMaxMind(cid, geoConfig, force);
                break;
            default:
                console.warn(`[GeoService] Unknown provider '${provider}' for client ${cid}.`);
        }
    }

    async _processMaxMind(cid, geoConfig, force) {
        const { dbPath, updateFrequency, apiKey, downloadUrl } = geoConfig;

        if (!dbPath) {
            console.error(`[GeoService] Missing dbPath for CID: ${cid}`);
            return;
        }

        const directory = path.dirname(dbPath);
        const filename = path.basename(dbPath);
        const finalFilename = `${cid}_${filename}`;
        const finalDbPath = path.join(directory, finalFilename);
        const tmpDbPath = path.join(directory, `${finalFilename}.tmp`);

        if (!this._shouldUpdate(finalDbPath, updateFrequency, force)) {
            return;
        }

        try {
            let sourcePath = null;

            if (apiKey) {
                const editionId = filename.replace('.mmdb', '');
                const url = `https://download.maxmind.com/app/geoip_download?edition_id=${editionId}&license_key=${apiKey}&suffix=tar.gz`;

                await this._downloadFile(url, tmpDbPath);
                sourcePath = tmpDbPath;
            } else {
                const defaultUrl = `https://git.io/${filename}`;
                const targetUrl = downloadUrl || defaultUrl;
                sourcePath = await this._getFromSharedCache(targetUrl, filename, force);
            }

            if (sourcePath) {
                this._applyUpdate(sourcePath, tmpDbPath, finalDbPath, cid);
            }
        } catch (error) {
            console.error(`[GeoService] Update failed for ${cid}:`, error.message);
            if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
        }
    }

    _applyUpdate(sourcePath, tmpPath, finalPath, cid) {
        if (sourcePath !== tmpPath) {
            fs.copyFileSync(sourcePath, tmpPath);
        }

        fs.renameSync(tmpPath, finalPath);

        const cleared = extractGeoData.invalidateLookup(finalPath);

        if (!cleared) {
        }
    }

    _shouldUpdate(filePath, frequencyDays = 7, force = false) {
        if (force) return true;
        if (!fs.existsSync(filePath)) return true;

        const stats = fs.statSync(filePath);
        const now = new Date();
        const diffDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);

        return diffDays >= frequencyDays;
    }

    async _getFromSharedCache(url, filename, force) {
        if (!fs.existsSync(SHARED_CACHE_DIR)) {
            fs.mkdirSync(SHARED_CACHE_DIR, { recursive: true });
        }

        const cacheFilePath = path.join(SHARED_CACHE_DIR, filename);

        if (!this._shouldUpdate(cacheFilePath, 1, force)) {
            return cacheFilePath;
        }

        if (activeDownloads.has(url)) {
            return activeDownloads.get(url);
        }

        const downloadPromise = (async () => {
            const tmpCachePath = `${cacheFilePath}.tmp`;
            await this._downloadFile(url, tmpCachePath);
            fs.renameSync(tmpCachePath, cacheFilePath);
            return cacheFilePath;
        })();

        activeDownloads.set(url, downloadPromise);

        try {
            return await downloadPromise;
        } finally {
            activeDownloads.delete(url);
        }
    }

    async _downloadFile(url, destPath) {
        const writer = fs.createWriteStream(destPath);
        const response = await axios({ url, method: 'GET', responseType: 'stream' });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve());
            writer.on('error', (err) => {
                console.error('[GeoService] Error writing file:', err.message);
                writer.close();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    }
}

module.exports = new GeoService();