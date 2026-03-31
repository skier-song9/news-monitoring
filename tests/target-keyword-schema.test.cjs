'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  defaultTargetKeywordDisplayOrder,
  defaultTargetKeywordIsActive,
  targetKeywordSourceTypes,
} = require('../src/db/schema/target-keyword.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

test('target keyword rows default to active with the shared display order', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');

    INSERT INTO target_keyword (id, monitoring_target_id, keyword, source_type)
    VALUES ('keyword-1', 'target-1', 'Acme Holdings', 'seed');
  `);

  const keyword = db
    .prepare('SELECT is_active, display_order FROM target_keyword WHERE id = ?')
    .get('keyword-1');

  assert.equal(keyword.is_active, defaultTargetKeywordIsActive);
  assert.equal(keyword.display_order, defaultTargetKeywordDisplayOrder);

  db.close();
});

test('target keyword rows must reference an existing monitoring target', () => {
  const db = createDatabase();

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO target_keyword (id, monitoring_target_id, keyword, source_type)
        VALUES ('keyword-1', 'target-missing', 'Acme Holdings', 'seed');
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.close();
});

test('target keyword rows enforce source type, active state, and display order constraints', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO target_keyword (id, monitoring_target_id, keyword, source_type)
        VALUES ('keyword-invalid-source', 'target-1', 'Acme Holdings', 'manual');
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO target_keyword (id, monitoring_target_id, keyword, source_type, is_active)
        VALUES ('keyword-invalid-active', 'target-1', 'Acme Holdings', 'seed', 2);
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO target_keyword (id, monitoring_target_id, keyword, source_type, display_order)
        VALUES ('keyword-invalid-order', 'target-1', 'Acme Holdings', 'seed', -1);
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('target keyword constants match the migration contract', () => {
  assert.deepEqual(targetKeywordSourceTypes, ['seed', 'expanded', 'excluded']);
  assert.equal(defaultTargetKeywordIsActive, 1);
  assert.equal(defaultTargetKeywordDisplayOrder, 0);
});
