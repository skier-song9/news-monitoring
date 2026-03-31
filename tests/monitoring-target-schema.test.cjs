'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetStatuses,
  monitoringTargetTypes,
} = require('../src/db/schema/monitoring-target.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

test('monitoring target rows default to review required with the shared risk threshold', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');
  `);

  const target = db.prepare('SELECT status, default_risk_threshold FROM monitoring_target WHERE id = ?').get('target-1');

  assert.equal(target.status, defaultMonitoringTargetStatus);
  assert.equal(target.default_risk_threshold, defaultMonitoringTargetRiskThreshold);

  db.close();
});

test('monitoring target rows must reference an existing workspace', () => {
  const db = createDatabase();

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target (id, workspace_id, type, display_name)
        VALUES ('target-1', 'workspace-missing', 'company', 'Acme Holdings');
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.close();
});

test('monitoring target rows enforce type, status, and threshold constraints', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target (id, workspace_id, type, display_name)
        VALUES ('target-invalid-type', 'workspace-1', 'brand', 'Acme Holdings');
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target (id, workspace_id, type, display_name, status)
        VALUES ('target-invalid-status', 'workspace-1', 'company', 'Acme Holdings', 'draft');
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target (
          id,
          workspace_id,
          type,
          display_name,
          default_risk_threshold
        )
        VALUES ('target-invalid-threshold', 'workspace-1', 'company', 'Acme Holdings', 101);
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('monitoring target constants match the migration contract', () => {
  assert.deepEqual(monitoringTargetTypes, ['company', 'person']);
  assert.deepEqual(monitoringTargetStatuses, [
    defaultMonitoringTargetStatus,
    'profile_in_progress',
    'ready_for_review',
    'awaiting_activation',
    'active',
    'paused',
    'archived',
  ]);
  assert.equal(defaultMonitoringTargetStatus, 'review_required');
  assert.equal(defaultMonitoringTargetRiskThreshold, 70);
});
