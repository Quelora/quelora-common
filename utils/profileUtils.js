/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { cacheService } = require('../services/cacheService');
const profileService = require('../services/profileService');
const ProfileFollowing = require('../models/ProfileFollowing');
const Profile = require('../models/Profile');
const { mongoose } = require('../db');
const { Types } = require('mongoose');

const getSessionUserId = async (author, cid, forceString = false) => {
    if (!author) return null;

    const cacheKey = `sessionUserId:${cid}:${author}`;
    const cachedUserId = await cacheService.get(cacheKey);

    let sessionUserId = null;

    if (cachedUserId) {
        sessionUserId = cachedUserId;
    } else {
        const sessionProfile = await Profile.findOne({ author, cid }).select('_id').lean();
        sessionUserId = sessionProfile?._id || null;

        if (sessionUserId) {
            await cacheService.set(cacheKey, sessionUserId.toString(), 3600);
        }
    }

    if (!sessionUserId) return null;

    try {
        return forceString 
            ? sessionUserId.toString() 
            : new Types.ObjectId(sessionUserId);
    } catch (error) {
        return forceString ? String(sessionUserId) : sessionUserId;
    }
};

const getUserLanguage = async (author, cid) => {
    if (!author) return 'en';
    try {
        const userProfile = await profileService.getProfile(author, cid);
        if (userProfile && userProfile.locale) {
            return userProfile.locale.split('-')[0];
        }
    } catch (error) {
        console.error(`Error al obtener el perfil para el autor ${author}:`, error);
    }
    return 'en';
};

const getProfilesForComments = async (comments, sessionUserId = null, cid) => {
    if (!comments || comments.length === 0) return {};

    const authorIds = comments.map(comment => comment.author);
    const uniqueAuthorIds = [...new Set(authorIds)];
    
    const cacheKey = `cid:${cid}:profiles:v3:${uniqueAuthorIds.sort().join(':')}`;
    const cachedProfiles = await cacheService.get(cacheKey);
    if (cachedProfiles) return cachedProfiles;

    const profiles = await Profile.find({ author: { $in: uniqueAuthorIds }, cid })
        .select('author name given_name family_name picture locale created_at followersCount followingCount commentsCount settings.privacy.showActivity')
        .lean();

    const profileIds = profiles.map(p => p._id);
    
    let GamificationProfile = null;
    let GamificationInventory = null;
    
    try {
        GamificationProfile = mongoose.model('GamificationProfile');
        GamificationInventory = mongoose.model('GamificationInventory');
    } catch (e) {
    }

    const gamificationMap = new Map();
    
    if (GamificationProfile && profileIds.length > 0) {
        try {
            const gamProfiles = await GamificationProfile.find({ 
                profile_id: { $in: profileIds }, 
                cid 
            })
            .populate('currentLevel', 'name avatarFrameUrl')
            .lean();

            gamProfiles.forEach(gp => {
                if (gp.currentLevel) {
                    gamificationMap.set(gp.profile_id.toString(), {
                        avatarFrameUrl: gp.currentLevel.avatarFrameUrl || null,
                        levelName: gp.currentLevel.name || null,
                        avatarFrameType: 'CIRCULAR'
                    });
                }
            });

            if (GamificationInventory) {
                const activeFrames = await GamificationInventory.find({
                    cid,
                    profile_id: { $in: profileIds },
                    isActive: true
                })
                .populate({
                    path: 'item_id',
                    match: { effectType: 'PROFILE_FRAME' },
                    select: 'effectType metadata'
                })
                .lean();

                activeFrames.forEach(inv => {
                    if (inv.item_id) {
                        const pid = inv.profile_id.toString();
                        const currentData = gamificationMap.get(pid) || { avatarFrameUrl: null, levelName: null };
                        
                        gamificationMap.set(pid, {
                            ...currentData,
                            avatarFrameUrl: inv.item_id.metadata?.assetUrl || currentData.avatarFrameUrl,
                            avatarFrameType: inv.item_id.metadata?.shape || 'CIRCULAR'
                        });
                    }
                });
            }

        } catch (error) {
            console.error('Error hydrating gamification profiles:', error.message);
        }
    }

    const followedProfileIds = new Set();
    if (sessionUserId && profiles.length > 0) {
        const followingRelations = await ProfileFollowing.find({
            follower_id: sessionUserId,
            following_id: { $in: profileIds }
        }).select('following_id').lean();

        followingRelations.forEach(rel => {
            followedProfileIds.add(rel.following_id.toString());
        });
    }

    const profileMap = {};
    
    profiles.forEach(profile => {
        const { settings, ...profileData } = profile;
        
        let visibility = 'private';
        const showActivity = settings?.privacy?.showActivity;

        if (showActivity === 'everyone') visibility = 'public';
        else if (showActivity === 'followers') visibility = 'restricted';
        else if (showActivity === 'onlyme') visibility = 'private';

        const gameData = gamificationMap.get(profile._id.toString()) || { avatarFrameUrl: null, levelName: null, avatarFrameType: null };

        profileMap[profile.author] = {
            ...profileData,
            visibility,
            isFollowing: followedProfileIds.has(profile._id.toString()),
            avatarFrameUrl: gameData.avatarFrameUrl,
            avatarFrameType: gameData.avatarFrameType,
            levelName: gameData.levelName
        };
    });

    await cacheService.set(cacheKey, profileMap, 3600);
    
    return profileMap;
};

module.exports = { getSessionUserId, getUserLanguage, getProfilesForComments };