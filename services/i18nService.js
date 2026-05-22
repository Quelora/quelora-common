/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const fs = require('fs').promises;
const path = require('path');
const { toUnicodeBold } = require('../utils/textUtils');

const translationCache = {};

/**
 * Loads translation file for a given locale from a specific path
 * @param {string} locale - Language code (e.g., 'es', 'en')
 * @param {string|null} customPath - Optional absolute path to locale directory
 * @returns {Promise<Object>} Translation dictionary
 */
async function loadTranslation(locale, customPath = null) {
  const basePath = customPath || path.join(__dirname, '../locale');
  const cacheKey = `${locale}:${basePath}`;

  if (translationCache[cacheKey]) {
    return translationCache[cacheKey];
  }

  try {
    const filePath = path.join(basePath, `${locale}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    const translations = JSON.parse(data);
    
    translationCache[cacheKey] = translations;
    return translations;
  } catch (error) {
    console.error(`Failed to load translation for ${locale} at ${basePath}: ${error.message}`);
    return {};
  }
}

/**
 * Translates a message using the locale's translation file with variable replacement
 * @param {string} message - Message key to translate
 * @param {string} locale - Language code (e.g., 'es', 'en')
 * @param {Object} [variables] - Key-value pairs for variable replacement
 * @param {string|null} [customLocalePath] - Optional absolute path to override translation source
 * @returns {Promise<string>} Translated message
 */
async function getLocalizedMessage(message, locale, variables = {}, customLocalePath = null) {
  if (!message) return '';

  const resolveKey = (translations) => {
    const keyParts = message.split('.');
    let current = translations;

    for (const part of keyParts) {
      current = current?.[part];
      if (current === undefined) return null;
    }

    return typeof current === 'string' ? current : null;
  };


  let translations = await loadTranslation(locale, customLocalePath);
  let translated = resolveKey(translations);

  if (!translated && locale !== 'en') {
    const enTranslations = await loadTranslation('en', customLocalePath);
    translated = resolveKey(enTranslations);
  }

  if (!translated) {
    translated = message;
  }

  translated = translated.replace(
    /\{(\w+)\|bold\}/g,
    (_, varName) => toUnicodeBold(variables[varName] ?? '')
  );

  for (const [key, value] of Object.entries(variables)) {
    translated = translated.replace(
      new RegExp(`\\{${key}\\}`, 'g'),
      String(value ?? '')
    );
  }

  return translated;
}


module.exports = { getLocalizedMessage };