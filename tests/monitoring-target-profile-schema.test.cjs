'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

test('monitoring target profiles default JSON fields to empty arrays', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');

    INSERT INTO monitoring_target_profile (
      id,
      workspace_id,
      monitoring_target_id,
      summary,
      model_version,
      generated_at
    )
    VALUES (
      'profile-1',
      'workspace-1',
      'target-1',
      'Profile summary',
      'gpt-test-1',
      '2026-03-30T12:00:00.000Z'
    );
  `);

  const profile = db
    .prepare(`
      SELECT related_entities_json, aliases_json, search_results_json
      FROM monitoring_target_profile
      WHERE id = ?
    `)
    .get('profile-1');

  assert.deepEqual({ ...profile }, {
    related_entities_json: '[]',
    aliases_json: '[]',
    search_results_json: '[]',
  });

  db.close();
});

test('monitoring target profiles stay tenant-scoped and unique per target', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme'),
           ('workspace-2', 'globex', 'Globex');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings'),
           ('target-2', 'workspace-2', 'company', 'Globex Holdings');

    INSERT INTO monitoring_target_profile (
      id,
      workspace_id,
      monitoring_target_id,
      summary,
      model_version,
      generated_at
    )
    VALUES (
      'profile-1',
      'workspace-1',
      'target-1',
      'Profile summary',
      'gpt-test-1',
      '2026-03-30T12:00:00.000Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_profile (
          id,
          workspace_id,
          monitoring_target_id,
          summary,
          model_version,
          generated_at
        )
        VALUES (
          'profile-duplicate',
          'workspace-1',
          'target-1',
          'Duplicate profile',
          'gpt-test-1',
          '2026-03-30T12:05:00.000Z'
        );
      `),
    /UNIQUE constraint failed: monitoring_target_profile\.workspace_id, monitoring_target_profile\.monitoring_target_id/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_profile (
          id,
          workspace_id,
          monitoring_target_id,
          summary,
          model_version,
          generated_at
        )
        VALUES (
          'profile-cross-workspace',
          'workspace-2',
          'target-1',
          'Cross-workspace profile',
          'gpt-test-1',
          '2026-03-30T12:10:00.000Z'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.close();
});
