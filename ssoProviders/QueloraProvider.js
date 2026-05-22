/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora/ssoProviders/QueloraProvider.js */
const jwt = require('jsonwebtoken');
const Profile = require('../models/Profile');
const crypto = require('crypto');

class QueloraProvider {
    constructor(config) {
        this.config = config;
    }

    async deriveKeyBackend(keyMaterial, salt) {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(
                keyMaterial,
                salt,
                100000,
                32,
                'sha256',
                (err, derivedKey) => {
                    if (err) return reject(err);
                    resolve(derivedKey);
                }
            );
        });
    }

    async decryptCredentialsBackend(encryptedBase64, keyMaterial) {
        const base64 = encryptedBase64.replace(/-/g, '+').replace(/_/g, '/');
        const encryptedBuffer = Buffer.from(base64, 'base64');

        if (encryptedBuffer.length < 44) {
            throw new Error('Encrypted payload too short.');
        }

        const salt = encryptedBuffer.slice(0, 16);
        const iv = encryptedBuffer.slice(16, 28);
        const ciphertextWithTag = encryptedBuffer.slice(28);

        const AUTH_TAG_LENGTH = 16;
        const authTag = ciphertextWithTag.slice(-AUTH_TAG_LENGTH);
        const actualCiphertext = ciphertextWithTag.slice(0, -AUTH_TAG_LENGTH);

        const key = await this.deriveKeyBackend(keyMaterial, salt);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(actualCiphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        const decodedString = decrypted.toString('utf8');
        return JSON.parse(decodedString);
    }

    async verify(encryptedCredential) {
        try {
            const cid = this.config.cid;

            if (!cid) {
                throw new Error('Client ID (CID) is missing for decryption.');
            }

            const credentials = await this.decryptCredentialsBackend(encryptedCredential, cid);

            const { username, password } = credentials;

            if (!username || !password) {
                throw new Error('Username and password are required in credential.');
            }

            const profile = await Profile.findOne({ email: username, cid: cid });

            if (!profile || !profile.password) {
                throw new Error('Invalid credentials or user does not exist.');
            }

            const isMatch = await profile.comparePassword(password);
            if (!isMatch) {
                throw new Error('Invalid credentials.');
            }

            const issuedAtTime = Math.floor(Date.now() / 1000);
            const tokenExpiration = issuedAtTime + (this.config.jwtTimeToLive || 3600 * 48);

            const jwtPayload = {
                iss: this.config.baseURL,
                sub: profile.author,
                aud: this.config.baseURL,
                iat: issuedAtTime,
                exp: tokenExpiration,
                email: profile.email || '',
                given_name: profile.given_name || '',
                family_name: profile.family_name || '',
                picture: profile.picture || '',
                locale: profile.locale || 'en',
                author: profile.author
            };

            const token = jwt.sign(jwtPayload, this.config.jwtSecretKey);

            return {
                status: 'success',
                token: token,
                expires_in: tokenExpiration
            };
        } catch (error) {
            console.error('QueloraProvider Error:', error.message);
            return {
                status: 'error',
                token: '',
                expires_in: '',
                error: error.message
            };
        }
    }
}

module.exports = QueloraProvider;