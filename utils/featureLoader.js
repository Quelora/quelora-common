/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: backend/utils/moduleLoader.js */
/**
 * @module Core/ModuleLoader
 * @description Provides safe, environment-aware dynamic module loading.
 * Implements an architectural kill switch to prevent Enterprise feature 
 * leakage in Community-only deployments or local mixed-repository testing.
 */

/**
 * Safely attempts to load optional (Enterprise) modules.
 * Enforces a strict fallback to Community mode if configured via environment
 * variables, guaranteeing the backend does not emit Enterprise-exclusive
 * payloads (e.g., binary resilience streams) to incompatible clients.
 *
 * @param {string} moduleName - The exact resolution path or package name of the module.
 * @returns {Object|null} The required module, or null if absent or explicitly disabled.
 * @throws {Error} If the module exists but contains syntax errors or missing internal dependencies.
 */
const loadOptionalModule = (moduleName) => {
    const isCommunityForced = process.env.QUELORA_EDITION === 'community' || process.env.DISABLE_ENTERPRISE === 'true';

    if (isCommunityForced) {
        return null;
    }

    try {
        return require(moduleName);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            const isTargetModuleMissing = e.message.includes(`'${moduleName}'`) || e.message.includes(`"${moduleName}"`);
            
            if (isTargetModuleMissing) {
                return null;
            }
            
            console.error(`\n⚠️ [CRITICAL ARCHITECTURE WARNING] Optional module '${moduleName}' was found, but failed to load due to a missing internal dependency.`);
            console.error(`   Details: ${e.message}\n`);
            throw e;
        }
        
        throw e;
    }
};

module.exports = {
    loadOptionalModule
};