/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const ProfileSuggestion = require('../models/ProfileSuggestion');

const SUGGESTION_TARGET = 20;

const generateOnboardingSuggestions = async (author, cid) => {
    const Profile = require('../models/Profile');
    console.time('OnboardingSuggest');

    try {
        const profile = await Profile.findOne({ author, cid })
            .select('geohash cid')
            .lean();

        if (!profile) {
            console.warn(`⚠️ [Onboarding] Profile not found for _id: ${profile._id}`);
            return;
        }

        const { geohash, _id } = profile; // Destructure after fetching

        let candidates = new Map(); 

        // --- LEVEL 1: IMMEDIATE NEIGHBORS (High Precision ~1.2km) ---
        if (geohash && geohash.length >= 6) {
            const exactNeighbors = await Profile.find({
                cid: cid,
                _id: { $ne: _id },
                geohash: { $regex: `^${geohash.substring(0, 6)}` },
                isBanned: false
            })
            .sort({ followersCount: -1 })
            .limit(SUGGESTION_TARGET)
            .select('_id followersCount isVerified')
            .lean();

            exactNeighbors.forEach(p => candidates.set(p._id.toString(), { ...p, reason: 'near_you_exact' }));
        }

        // --- LEVEL 2: CITY / DISTRICT (Medium Precision ~20-30km) ---
        if (candidates.size < SUGGESTION_TARGET && geohash && geohash.length >= 4) {
            const needed = SUGGESTION_TARGET - candidates.size;
            
            const alreadyFoundIds = Array.from(candidates.keys());

            const areaNeighbors = await Profile.find({
                cid: cid,
                _id: { $nin: [_id, ...alreadyFoundIds] },
                geohash: { $regex: `^${geohash.substring(0, 4)}` },
                isBanned: false
            })
            .sort({ followersCount: -1 })
            .limit(needed)
            .select('_id followersCount isVerified')
            .lean();

            areaNeighbors.forEach(p => candidates.set(p._id.toString(), { ...p, reason: 'near_you_area' }));
        }

        // --- LEVEL 3: COMMUNITY FALLBACK (Pure Popularity) ---
        if (candidates.size < SUGGESTION_TARGET) {
            const needed = SUGGESTION_TARGET - candidates.size;
            const alreadyFoundIds = Array.from(candidates.keys());

            const communityStars = await Profile.find({
                cid: cid,
                _id: { $nin: [_id, ...alreadyFoundIds] },
                isBanned: false
            })
            .sort({ followersCount: -1 })
            .limit(needed)
            .select('_id followersCount isVerified')
            .lean();

            communityStars.forEach(p => candidates.set(p._id.toString(), { ...p, reason: 'popular_community' }));
        }

        // --- FINAL SAVE Y MAPPING DEL ENUM ---
        if (candidates.size > 0) {
            const suggestionsPayload = Array.from(candidates.values()).map(c => {
                let score = 0;
                let reason;

                // Mapeo a las razones del ENUM permitido: ['location', 'social', 'interest', 'popular']
                if (c.reason === 'near_you_exact') {
                    score = 100;
                    reason = 'location';
                } else if (c.reason === 'near_you_area') {
                    score = 50;
                    reason = 'location';
                } else { 
                    score = 25;
                    reason = 'popular';
                }

                // Boost for verified accounts
                if (c.isVerified) score += 5;

                return {
                    target_id: c._id,
                    score: score,
                    reason: reason,
                };
            });

            await ProfileSuggestion.create({
                profile_id: _id,
                suggestions: suggestionsPayload,
                updated_at: new Date()
            });
        }

        console.log(`✅ [Onboarding] Suggestions created for ${_id}. Found: ${candidates.size}`);

    } catch (error) {
        console.error('⚠️ [Onboarding] Error generating suggestions:', error);
    } finally {
        console.timeEnd('OnboardingSuggest');
    }
};

module.exports = { generateOnboardingSuggestions };