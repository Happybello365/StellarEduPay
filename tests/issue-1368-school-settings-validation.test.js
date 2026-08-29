'use strict';

/**
 * #1368 — school.settings Mixed type validation
 *
 * Verifies that validateSettingValue() rejects invalid types for every
 * known setting key before the value is persisted, and that setSchoolSetting
 * propagates those errors without writing to the database.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../backend/src/utils/logger', () => ({
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const mockFindOneAndUpdate = jest.fn();

jest.mock('../backend/src/models/schoolModel', () => ({
  findOne:          jest.fn(),
  findOneAndUpdate: (...args) => ({ lean: () => Promise.resolve(mockFindOneAndUpdate(...args)) }),
}));

jest.mock('../backend/src/models/systemConfigModel', () => ({
  get: jest.fn().mockResolvedValue(null),
}));

jest.mock('../backend/src/services/schoolCacheInvalidator', () => ({
  invalidate: jest.fn(),
}));

// ── Subject ───────────────────────────────────────────────────────────────────

const {
  validateSettingValue,
  setSchoolSetting,
  SETTING_KEYS,
  DEFAULTS,
} = require('../backend/src/services/schoolSettingsService');

const SCHOOL_ID = 'SCH-TEST';

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOneAndUpdate.mockReturnValue({ settings: {} });
});

// ── SETTING_KEYS includes reminderTimeWindow ──────────────────────────────────

describe('SETTING_KEYS', () => {
  test('includes reminderTimeWindow', () => {
    expect(SETTING_KEYS.has('reminderTimeWindow')).toBe(true);
  });

  test('includes all previously known keys', () => {
    for (const key of ['maxSyncBatchSize', 'reminderEnabled', 'reminderIntervalMs', 'maintenanceMode', 'betaFeatures']) {
      expect(SETTING_KEYS.has(key)).toBe(true);
    }
  });
});

// ── DEFAULTS includes reminderTimeWindow ─────────────────────────────────────

describe('DEFAULTS', () => {
  test('reminderTimeWindow defaults to { startHour: 8, endHour: 18 }', () => {
    expect(DEFAULTS.reminderTimeWindow).toEqual({ startHour: 8, endHour: 18 });
  });
});

// ── validateSettingValue — valid values ───────────────────────────────────────

describe('validateSettingValue — valid values', () => {
  test('maxSyncBatchSize: positive integer', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', 10)).not.toThrow();
  });

  test('reminderIntervalMs: positive integer', () => {
    expect(() => validateSettingValue('reminderIntervalMs', 86400000)).not.toThrow();
  });

  test('reminderEnabled: true', () => {
    expect(() => validateSettingValue('reminderEnabled', true)).not.toThrow();
  });

  test('reminderEnabled: false', () => {
    expect(() => validateSettingValue('reminderEnabled', false)).not.toThrow();
  });

  test('maintenanceMode: false', () => {
    expect(() => validateSettingValue('maintenanceMode', false)).not.toThrow();
  });

  test('betaFeatures: empty array', () => {
    expect(() => validateSettingValue('betaFeatures', [])).not.toThrow();
  });

  test('betaFeatures: array of strings', () => {
    expect(() => validateSettingValue('betaFeatures', ['feature-a', 'feature-b'])).not.toThrow();
  });

  test('reminderTimeWindow: valid { startHour: 8, endHour: 18 }', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8, endHour: 18 })).not.toThrow();
  });

  test('reminderTimeWindow: edge case startHour=0, endHour=1', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 0, endHour: 1 })).not.toThrow();
  });

  test('reminderTimeWindow: edge case startHour=23, endHour=24', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 23, endHour: 24 })).not.toThrow();
  });
});

// ── validateSettingValue — maxSyncBatchSize / reminderIntervalMs invalid ─────

describe('validateSettingValue — numeric keys reject invalid values', () => {
  test('maxSyncBatchSize: string rejects', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', 'twenty'))
      .toThrow(TypeError);
  });

  test('maxSyncBatchSize: zero rejects (must be > 0)', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', 0))
      .toThrow(TypeError);
  });

  test('maxSyncBatchSize: negative rejects', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', -5))
      .toThrow(TypeError);
  });

  test('maxSyncBatchSize: float rejects (must be integer)', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', 1.5))
      .toThrow(TypeError);
  });

  test('maxSyncBatchSize: boolean rejects', () => {
    expect(() => validateSettingValue('maxSyncBatchSize', true))
      .toThrow(TypeError);
  });

  test('reminderIntervalMs: string rejects', () => {
    expect(() => validateSettingValue('reminderIntervalMs', '24h'))
      .toThrow(TypeError);
  });

  test('reminderIntervalMs: zero rejects', () => {
    expect(() => validateSettingValue('reminderIntervalMs', 0))
      .toThrow(TypeError);
  });
});

// ── validateSettingValue — boolean keys ───────────────────────────────────────

describe('validateSettingValue — boolean keys reject non-booleans', () => {
  test('reminderEnabled: string "true" rejects', () => {
    expect(() => validateSettingValue('reminderEnabled', 'true'))
      .toThrow(TypeError);
  });

  test('reminderEnabled: number 1 rejects', () => {
    expect(() => validateSettingValue('reminderEnabled', 1))
      .toThrow(TypeError);
  });

  test('maintenanceMode: null rejects', () => {
    expect(() => validateSettingValue('maintenanceMode', null))
      .toThrow(TypeError);
  });

  test('maintenanceMode: object rejects', () => {
    expect(() => validateSettingValue('maintenanceMode', {}))
      .toThrow(TypeError);
  });
});

// ── validateSettingValue — betaFeatures ───────────────────────────────────────

describe('validateSettingValue — betaFeatures rejects non-string elements', () => {
  test('plain string rejects', () => {
    expect(() => validateSettingValue('betaFeatures', 'feature-a'))
      .toThrow(TypeError);
  });

  test('array with number element rejects', () => {
    expect(() => validateSettingValue('betaFeatures', ['ok', 123]))
      .toThrow(TypeError);
  });

  test('array with boolean element rejects', () => {
    expect(() => validateSettingValue('betaFeatures', [true]))
      .toThrow(TypeError);
  });

  test('null rejects', () => {
    expect(() => validateSettingValue('betaFeatures', null))
      .toThrow(TypeError);
  });
});

// ── validateSettingValue — reminderTimeWindow ─────────────────────────────────

describe('validateSettingValue — reminderTimeWindow', () => {
  test('string startHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 'eight', endHour: 18 }))
      .toThrow(TypeError);
  });

  test('string endHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8, endHour: 'eighteen' }))
      .toThrow(TypeError);
  });

  test('float startHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8.5, endHour: 18 }))
      .toThrow(TypeError);
  });

  test('float endHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8, endHour: 18.5 }))
      .toThrow(TypeError);
  });

  test('startHour < 0 rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: -1, endHour: 8 }))
      .toThrow(TypeError);
  });

  test('startHour > 23 rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 24, endHour: 25 }))
      .toThrow(TypeError);
  });

  test('endHour < 1 rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 0, endHour: 0 }))
      .toThrow(TypeError);
  });

  test('endHour > 24 rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 0, endHour: 25 }))
      .toThrow(TypeError);
  });

  test('startHour === endHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8, endHour: 8 }))
      .toThrow(TypeError);
  });

  test('startHour > endHour rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 18, endHour: 8 }))
      .toThrow(TypeError);
  });

  test('array instead of object rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', [8, 18]))
      .toThrow(TypeError);
  });

  test('null rejects', () => {
    expect(() => validateSettingValue('reminderTimeWindow', null))
      .toThrow(TypeError);
  });

  test('error message mentions reminderTimeWindow.startHour for bad startHour', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 'eight', endHour: 18 }))
      .toThrow(/reminderTimeWindow\.startHour/);
  });

  test('error message mentions reminderTimeWindow.endHour for bad endHour', () => {
    expect(() => validateSettingValue('reminderTimeWindow', { startHour: 8, endHour: 'eighteen' }))
      .toThrow(/reminderTimeWindow\.endHour/);
  });
});

// ── setSchoolSetting — validation prevents DB write ──────────────────────────

describe('setSchoolSetting — validation blocks bad values', () => {
  test('does not call findOneAndUpdate when reminderTimeWindow.startHour is a string', async () => {
    await expect(
      setSchoolSetting(SCHOOL_ID, 'reminderTimeWindow', { startHour: 'eight', endHour: 18 }),
    ).rejects.toThrow(TypeError);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does not call findOneAndUpdate when maxSyncBatchSize is a string', async () => {
    await expect(
      setSchoolSetting(SCHOOL_ID, 'maxSyncBatchSize', 'twenty'),
    ).rejects.toThrow(TypeError);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does not call findOneAndUpdate when reminderEnabled is a number', async () => {
    await expect(
      setSchoolSetting(SCHOOL_ID, 'reminderEnabled', 1),
    ).rejects.toThrow(TypeError);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('calls findOneAndUpdate when reminderTimeWindow is valid', async () => {
    await setSchoolSetting(SCHOOL_ID, 'reminderTimeWindow', { startHour: 9, endHour: 17 });
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { schoolId: SCHOOL_ID },
      { $set: { 'settings.reminderTimeWindow': { startHour: 9, endHour: 17 } } },
      { new: true },
    );
  });
});
