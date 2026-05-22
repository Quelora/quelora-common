/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: middleware/extractGeoData.js */
const maxmind = require('maxmind');
const path = require('path');
const fs = require('fs');

/**
 * In-memory cache for MaxMind database lookups.
 * Keyed by absolute database path.
 */
const lookups = new Map();

/**
 * Returns a cached MaxMind lookup instance or initializes it if missing.
 * The database is loaded only once per process.
 */
async function getLookup(dbPath) {
  if (lookups.has(dbPath)) {
    return lookups.get(dbPath);
  }

  try {
    if (!fs.existsSync(dbPath)) {
      return undefined;
    }

    const lookup = await maxmind.open(dbPath, { watchForChanges: false });
    lookups.set(dbPath, lookup);
    return lookup;
  } catch (error) {
    console.error('[GeoIP] Failed to open MaxMind DB:', error);
    return undefined;
  }
}

/**
 * Geolocation extraction middleware.
 *
 * Resolution order:
 * 1. Incoming headers (trusted upstream)
 * 2. MaxMind lookup (optional, configurable per client)
 * 3. Fallback to "Unknown"
 *
 * Enriches the request with:
 * - req.geoData
 * - req.clientIp / country / region / city / coordinates
 *
 * Optionally propagates resolved geo data back as response headers.
 */
async function extractGeoData(req, res, next) {
  try {
    const headerGeo = extractHeaders(req);
    const geoConfig = req.clientConfig?.geolocation || {};
    const backendConfig = geoConfig.backend || {};
    const cid = req.cid;

    let geo = {
      ...headerGeo,
      provider: headerGeo.ip ? 'header' : 'none'
    };

    const shouldLookupMaxMind =
      geoConfig.enabled &&
      backendConfig.provider === 'maxmind' &&
      !geo.city &&
      cid &&
      backendConfig.dbPath;

    if (shouldLookupMaxMind) {
      geo = await resolveWithMaxMind(req, geo, backendConfig, cid, res);
    }

    attachGeoToRequest(req, geo);
    return next();
  } catch (error) {
    console.error('[GeoIP] extractGeoData failed:', error);
    attachGeoToRequest(req, getFallbackGeo('error'));
    return next();
  }
}

/* -------------------------------------------------------------------------- */
/*                               Helper methods                               */
/* -------------------------------------------------------------------------- */

function extractHeaders(req) {
  return {
    ip: req.headers['x-ip'] || '',
    country: req.headers['x-country'] || '',
    countryCode: req.headers['x-country-code'] || '',
    region: req.headers['x-region'] || '',
    regionCode: req.headers['x-region-code'] || '',
    city: req.headers['x-city'] || '',
    lat: req.headers['x-lat'] || '',
    lon: req.headers['x-lon'] || ''
  };
}

async function resolveWithMaxMind(req, geo, backendConfig, cid, res) {
  const ip =
    geo.ip ||
    req.ip ||
    req.connection?.remoteAddress ||
    '';

  if (!ip) {
    return geo;
  }

  const directory = path.dirname(backendConfig.dbPath);
  const filename = path.basename(backendConfig.dbPath);
  const dbPath = path.join(directory, `${cid}_${filename}`);

  const lookup = await getLookup(dbPath);
  if (!lookup) {
    return geo;
  }

  const result = lookup.get(ip);

  if (!result || !result.country) {
    const fallback = {
      ...getFallbackGeo('maxmind_unknown'),
      ip
    };
    res.set(mapGeoToHeaders(fallback));
    return fallback;
  }

  const resolved = {
    ip,
    country: result.country?.names?.en || geo.country,
    countryCode: result.country?.iso_code || geo.countryCode,
    region: result.subdivisions?.[0]?.names?.en || geo.region,
    regionCode: result.subdivisions?.[0]?.iso_code || geo.regionCode,
    city: result.city?.names?.en || geo.city,
    lat: result.location?.latitude || geo.lat,
    lon: result.location?.longitude || geo.lon,
    provider: 'maxmind'
  };

  res.set(mapGeoToHeaders(resolved));
  return resolved;
}

function mapGeoToHeaders(geo) {
  return {
    'x-ip': geo.ip || '',
    'x-country': geo.country || '',
    'x-country-code': geo.countryCode || '',
    'x-region': geo.region || '',
    'x-region-code': geo.regionCode || '',
    'x-city': geo.city || '',
    'x-lat': geo.lat || '',
    'x-lon': geo.lon || ''
  };
}

function attachGeoToRequest(req, geo) {
  req.clientIp = geo.ip || 'Unknown';
  req.clientCountry = geo.country || 'Unknown';
  req.clientCountryCode = geo.countryCode || 'UNK';
  req.clientRegion = geo.region || 'Unknown';
  req.clientRegionCode = geo.regionCode || 'UNK';
  req.clientCity = geo.city || 'Unknown';
  req.clientLatitude = geo.lat || 'Unknown';
  req.clientLongitude = geo.lon || 'Unknown';

  req.geoData = {
    ip: req.clientIp,
    country: req.clientCountry,
    countryCode: req.clientCountryCode,
    region: req.clientRegion,
    regionCode: req.clientRegionCode,
    city: req.clientCity,
    lat: req.clientLatitude,
    lon: req.clientLongitude,
    provider: geo.provider || 'none'
  };
}

function getFallbackGeo(provider = 'none') {
  return {
    ip: 'Unknown',
    country: 'Unknown',
    countryCode: 'UNK',
    region: 'Unknown',
    regionCode: 'UNK',
    city: 'Unknown',
    lat: 'Unknown',
    lon: 'Unknown',
    provider
  };
}

/* -------------------------------------------------------------------------- */
/*                          Lookup cache invalidation                          */
/* -------------------------------------------------------------------------- */

/**
 * Explicitly invalidates a cached MaxMind lookup.
 * Useful when databases are rotated or updated on disk.
 */
function invalidateLookup(dbPath) {
  if (lookups.has(dbPath)) {
    console.log(`♻️  [GeoIP] Invalidating cache for: ${dbPath}`);
    lookups.delete(dbPath);
    return true;
  }
  return false;
}

extractGeoData.invalidateLookup = invalidateLookup;
module.exports = extractGeoData;
