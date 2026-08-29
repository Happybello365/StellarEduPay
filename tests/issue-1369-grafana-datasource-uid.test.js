'use strict';

/**
 * #1369 — Grafana dashboard datasource UID validation
 *
 * Verifies that every panel target in every provisioned dashboard JSON file
 * references the canonical datasource UID defined in the provisioning config,
 * so dashboards work on a fresh Grafana installation without manual editing.
 */

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml'); // bundled in devDeps via jest infra

// ── Paths ──────────────────────────────────────────────────────────────────────

const REPO_ROOT       = path.resolve(__dirname, '..');
const DASHBOARDS_DIR  = path.join(REPO_ROOT, 'monitoring', 'grafana', 'dashboards');
const DS_CONFIG_PATH  = path.join(REPO_ROOT, 'monitoring', 'grafana', 'provisioning', 'datasources', 'prometheus.yml');

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadDashboard(file) {
  return JSON.parse(fs.readFileSync(path.join(DASHBOARDS_DIR, file), 'utf8'));
}

function allTargets(dashboard) {
  const targets = [];
  for (const panel of (dashboard.panels || [])) {
    for (const target of (panel.targets || [])) {
      targets.push({ panel: panel.title || panel.id, target });
    }
  }
  return targets;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Grafana datasource provisioning', () => {
  let provisionedUid;

  beforeAll(() => {
    const raw = fs.readFileSync(DS_CONFIG_PATH, 'utf8');
    const config = yaml.load(raw);
    const ds = config.datasources[0];
    provisionedUid = ds.uid;
  });

  test('prometheus.yml defines a stable datasource uid', () => {
    expect(typeof provisionedUid).toBe('string');
    expect(provisionedUid.length).toBeGreaterThan(0);
  });
});

describe('Grafana dashboard JSON files', () => {
  const dashboardFiles = fs.readdirSync(DASHBOARDS_DIR).filter(f => f.endsWith('.json'));

  test('at least one dashboard JSON file exists', () => {
    expect(dashboardFiles.length).toBeGreaterThan(0);
  });

  for (const file of dashboardFiles) {
    describe(file, () => {
      let dashboard;
      let expectedUid;

      beforeAll(() => {
        dashboard = loadDashboard(file);
        const raw = fs.readFileSync(DS_CONFIG_PATH, 'utf8');
        const config = yaml.load(raw);
        expectedUid = config.datasources[0].uid;
      });

      test('every panel target has a datasource field', () => {
        const targets = allTargets(dashboard);
        // text / annotation panels have no targets — skip if none
        if (targets.length === 0) return;

        const missing = targets.filter(({ target }) => !target.datasource);
        expect(missing.map(m => `panel "${m.panel}": missing datasource`)).toEqual([]);
      });

      test('every panel target datasource uid matches the provisioned uid', () => {
        const targets = allTargets(dashboard);
        if (targets.length === 0) return;

        const wrong = targets.filter(
          ({ target }) => target.datasource && target.datasource.uid !== expectedUid,
        );
        expect(
          wrong.map(m => `panel "${m.panel}": uid "${m.target.datasource.uid}" != "${expectedUid}"`),
        ).toEqual([]);
      });

      test('every panel target datasource type is prometheus', () => {
        const targets = allTargets(dashboard);
        if (targets.length === 0) return;

        const wrong = targets.filter(
          ({ target }) => target.datasource && target.datasource.type !== 'prometheus',
        );
        expect(
          wrong.map(m => `panel "${m.panel}": type "${m.target.datasource.type}" != "prometheus"`),
        ).toEqual([]);
      });
    });
  }
});
