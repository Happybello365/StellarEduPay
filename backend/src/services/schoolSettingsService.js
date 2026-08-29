'use strict';

const School = require('../models/schoolModel');
const SystemConfig = require('../models/systemConfigModel');
const schoolCache = require('./schoolCacheInvalidator');

const SETTING_KEYS = new Set([
  'maxSyncBatchSize',
  'reminderEnabled',
  'reminderIntervalMs',
  'maintenanceMode',
  'betaFeatures',
  'reminderTimeWindow',
]);

const SYSTEM_CONFIG_MAP = {
  maxSyncBatchSize: 'maxSyncBatchSize',
  reminderEnabled: 'reminderEnabled',
  reminderIntervalMs: 'reminderIntervalMs',
  maintenanceMode: 'maintenanceMode',
};

const DEFAULTS = {
  maxSyncBatchSize: 20,
  reminderEnabled: true,
  reminderIntervalMs: 86400000,
  maintenanceMode: false,
  betaFeatures: [],
  reminderTimeWindow: { startHour: 8, endHour: 18 },
};

/**
 * Validate that a settings value matches the expected type for its key.
 *
 * Throws a TypeError with a descriptive message when the value is invalid,
 * so callers can return a 400 VALIDATION_ERROR before writing to the DB.
 *
 * Rules:
 *   maxSyncBatchSize   — positive integer (> 0)
 *   reminderEnabled    — boolean
 *   reminderIntervalMs — positive integer (> 0)
 *   maintenanceMode    — boolean
 *   betaFeatures       — array of strings
 *   reminderTimeWindow — { startHour: integer 0–23, endHour: integer 1–24 },
 *                        startHour must be < endHour
 *
 * @param {string} key   - setting key (must be in SETTING_KEYS)
 * @param {*}      value - proposed value
 * @throws {TypeError} with a human-readable message when invalid
 */
function validateSettingValue(key, value) {
  switch (key) {
    case 'maxSyncBatchSize':
    case 'reminderIntervalMs': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${key} must be a positive integer, got ${JSON.stringify(value)}`);
      }
      break;
    }

    case 'reminderEnabled':
    case 'maintenanceMode': {
      if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean, got ${JSON.stringify(value)}`);
      }
      break;
    }

    case 'betaFeatures': {
      if (!Array.isArray(value)) {
        throw new TypeError(`betaFeatures must be an array of strings, got ${JSON.stringify(value)}`);
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          throw new TypeError(
            `betaFeatures[${i}] must be a string, got ${JSON.stringify(value[i])}`,
          );
        }
      }
      break;
    }

    case 'reminderTimeWindow': {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        throw new TypeError(
          'reminderTimeWindow must be an object { startHour, endHour }, got ' +
          JSON.stringify(value),
        );
      }
      const { startHour, endHour } = value;
      if (
        typeof startHour !== 'number' ||
        !Number.isInteger(startHour) ||
        startHour < 0 ||
        startHour > 23
      ) {
        throw new TypeError(
          `reminderTimeWindow.startHour must be an integer 0–23, got ${JSON.stringify(startHour)}`,
        );
      }
      if (
        typeof endHour !== 'number' ||
        !Number.isInteger(endHour) ||
        endHour < 1 ||
        endHour > 24
      ) {
        throw new TypeError(
          `reminderTimeWindow.endHour must be an integer 1–24, got ${JSON.stringify(endHour)}`,
        );
      }
      if (startHour >= endHour) {
        throw new TypeError(
          `reminderTimeWindow.startHour (${startHour}) must be less than endHour (${endHour})`,
        );
      }
      break;
    }

    default:
      // Unknown keys are rejected by SETTING_KEYS check in callers;
      // we don't need to handle them here.
      break;
  }
}

async function getSchoolSetting(schoolId, key) {
  if (!SETTING_KEYS.has(key)) return undefined;

  const school = await School.findOne({ schoolId }, { settings: 1 }).lean();
  if (school && school.settings && school.settings[key] !== undefined) {
    return school.settings[key];
  }

  const systemKey = SYSTEM_CONFIG_MAP[key];
  if (systemKey) {
    const sysVal = await SystemConfig.get(systemKey);
    if (sysVal !== null && sysVal !== undefined) return sysVal;
  }

  return DEFAULTS[key];
}

async function setSchoolSetting(schoolId, key, value) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  // Validate type before persisting to guard the Mixed field
  validateSettingValue(key, value);
  const updated = await School.findOneAndUpdate(
    { schoolId },
    { $set: { [`settings.${key}`]: value } },
    { new: true },
  ).lean();
  if (updated) schoolCache.invalidate(updated);
  return updated;
}

async function getSchoolSettings(schoolId) {
  const school = await School.findOne({ schoolId }, { settings: 1 }).lean();
  const schoolOverrides = school?.settings || {};
  const merged = { ...DEFAULTS };

  for (const key of Object.keys(SYSTEM_CONFIG_MAP)) {
    const sysVal = await SystemConfig.get(SYSTEM_CONFIG_MAP[key]);
    if (sysVal !== null && sysVal !== undefined) {
      merged[key] = sysVal;
    }
  }

  Object.assign(merged, schoolOverrides);
  return merged;
}

async function clearSchoolSetting(schoolId, key) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  const updated = await School.findOneAndUpdate(
    { schoolId },
    { $unset: { [`settings.${key}`]: '' } },
    { new: true },
  ).lean();
  if (updated) schoolCache.invalidate(updated);
  return updated;
}

module.exports = {
  getSchoolSetting,
  setSchoolSetting,
  getSchoolSettings,
  clearSchoolSetting,
  SETTING_KEYS,
  DEFAULTS,
  validateSettingValue,
};
