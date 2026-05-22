/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./utils/imageHelper.js
const fs = require('fs/promises');
const path = require('path');

function validateImage(base64String) {
    const match = base64String.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
    if (!match) {
        console.warn('Invalid image format. Only png, jpeg, or webp are allowed.');
        return null;
    }

    const buffer = Buffer.from(match[3], 'base64');
    
    // 2MB de límite para avatares
    if (buffer.length > 2 * 1024 * 1024) {
        console.warn('Image size exceeds 2MB limit.');
        return null;
    }

    return buffer;
}

async function saveImageToDisk(base64String, filename, fileSystemUploadDir, publicUrlSegment) {
    const buffer = validateImage(base64String);
    if (!buffer) return null;
    
    const finalFilename = path.basename(filename, path.extname(filename)) + '.webp';
    const uploadDir = fileSystemUploadDir; 
    const filePath = path.join(uploadDir, finalFilename);

    try {
        await fs.mkdir(uploadDir, { recursive: true });
        
        await fs.writeFile(filePath, buffer);
   
        const baseUrl = process.env.BASE_URL || '';
        const publicUrl = new URL(`${publicUrlSegment}/${finalFilename}`, baseUrl).toString();
        
        return publicUrl;
        
    } catch (error) {
        console.error(`Error saving image ${finalFilename}:`, error);
        throw new Error(`Failed to save ${finalFilename}`);
    }
}

module.exports = {
    validateImage,
    saveImageToDisk
};