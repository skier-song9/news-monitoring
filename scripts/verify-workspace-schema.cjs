'use strict';

const { DatabaseSync } = require('node:sqlite');
const { applyMigrations } = require('../src/db/migrations.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function getIndexColumns(db, tableName, indexName) {
  return db
    .prepare(`PRAGMA index_info(${indexName})`)
    .all()
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name);
}

function requireIndex(db, tableName, expectedColumns, expectedUnique) {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all();
  const match = indexes.find((index) => {
    if (Boolean(index.unique) !== expectedUnique) {
      return false;
    }

    const columns = getIndexColumns(db, tableName, index.name);
    return columns.join(',') === expectedColumns.join(',');
  });

  if (!match) {
    throw new Error(
      `Expected ${expectedUnique ? 'unique ' : ''}index on ${tableName}(${expectedColumns.join(', ')})`,
    );
  }
}

function requireCompositeForeignKey(db, tableName, expectedReferenceTable, expectedPairs) {
  const rows = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
  const groups = new Map();

  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }

  const match = [...groups.values()].find((group) => {
    if (group[0].table !== expectedReferenceTable) {
      return false;
    }

    const pairs = group
      .sort((left, right) => left.seq - right.seq)
      .map((row) => `${row.from}->${row.to}`);

    return pairs.join(',') === expectedPairs.map((pair) => `${pair.from}->${pair.to}`).join(',');
  });

  if (!match) {
    throw new Error(
      `Expected foreign key on ${tableName} to ${expectedReferenceTable}: ${expectedPairs
        .map((pair) => `${pair.from}->${pair.to}`)
        .join(', ')}`,
    );
  }
}

function verifyWorkspaceSchema() {
  const db = createDatabase();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

  for (const tableName of [
    'article',
    'article_candidate',
    'monitoring_target',
    'target_keyword',
    'user_account',
    'workspace',
    'workspace_invitation',
    'workspace_membership',
  ]) {
    if (!tables.includes(tableName)) {
      throw new Error(`Expected table ${tableName} to exist`);
    }
  }

  requireIndex(db, 'article', ['workspace_id', 'id'], true);
  requireIndex(db, 'article', ['workspace_id', 'source_url'], true);
  requireIndex(db, 'article', ['workspace_id', 'canonical_url'], true);
  requireIndex(db, 'article', ['workspace_id', 'body_hash'], true);
  requireIndex(db, 'article', ['workspace_id', 'ingestion_status'], false);
  requireIndex(db, 'article', ['workspace_id', 'normalized_title_hash', 'body_hash'], false);
  requireIndex(db, 'article_candidate', ['monitoring_target_id', 'portal_url'], true);
  requireIndex(db, 'article_candidate', ['workspace_id', 'ingestion_status'], false);
  requireIndex(db, 'article_candidate', ['workspace_id', 'source_url'], false);
  requireIndex(db, 'monitoring_target', ['workspace_id', 'status'], false);
  requireIndex(db, 'monitoring_target', ['workspace_id', 'id'], true);
  requireIndex(db, 'monitoring_target', ['workspace_id', 'type'], false);
  requireIndex(db, 'target_keyword', ['monitoring_target_id', 'is_active', 'source_type', 'display_order'], false);
  requireIndex(db, 'target_keyword', ['monitoring_target_id', 'source_type'], false);
  requireIndex(db, 'workspace_membership', ['workspace_id', 'user_id'], true);
  requireIndex(db, 'workspace_membership', ['workspace_id', 'id'], true);
  requireIndex(db, 'workspace_invitation', ['workspace_id', 'email'], true);
  requireIndex(db, 'workspace_invitation', ['workspace_id', 'status'], false);

  requireCompositeForeignKey(db, 'article', 'workspace', [{ from: 'workspace_id', to: 'id' }]);
  requireCompositeForeignKey(db, 'article_candidate', 'workspace', [{ from: 'workspace_id', to: 'id' }]);
  requireCompositeForeignKey(db, 'article_candidate', 'article', [
    { from: 'workspace_id', to: 'workspace_id' },
    { from: 'article_id', to: 'id' },
  ]);
  requireCompositeForeignKey(db, 'article_candidate', 'monitoring_target', [
    { from: 'workspace_id', to: 'workspace_id' },
    { from: 'monitoring_target_id', to: 'id' },
  ]);
  requireCompositeForeignKey(db, 'target_keyword', 'monitoring_target', [{ from: 'monitoring_target_id', to: 'id' }]);
  requireCompositeForeignKey(db, 'monitoring_target', 'workspace', [{ from: 'workspace_id', to: 'id' }]);
  requireCompositeForeignKey(db, 'workspace_invitation', 'workspace_membership', [
    { from: 'workspace_id', to: 'workspace_id' },
    { from: 'invited_by_membership_id', to: 'id' },
  ]);
  requireCompositeForeignKey(db, 'workspace_invitation', 'workspace_membership', [
    { from: 'workspace_id', to: 'workspace_id' },
    { from: 'accepted_membership_id', to: 'id' },
  ]);

  applyMigrations(db);
  db.close();
}

if (require.main === module) {
  verifyWorkspaceSchema();
  console.log('Schema verified.');
}

module.exports = {
  verifyWorkspaceSchema,
};
