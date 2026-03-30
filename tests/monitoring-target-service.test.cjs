'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { createMonitoringTarget, MonitoringTargetServiceError } = require('../src/backend/monitoring-target-service.cjs');
const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
} = require('../src/db/schema/monitoring-target.cjs');
const { defaultTargetKeywordIsActive } = require('../src/db/schema/target-keyword.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertUser(db, { id, email, displayName }) {
  db.prepare(`
    INSERT INTO user_account (id, email, display_name)
    VALUES (?, ?, ?)
  `).run(id, email, displayName);
}

function insertWorkspace(db, { id, slug, name }) {
  db.prepare(`
    INSERT INTO workspace (id, slug, name)
    VALUES (?, ?, ?)
  `).run(id, slug, name);
}

function insertMembership(db, { id, workspaceId, userId, role = 'member', status = 'active' }) {
  db.prepare(`
    INSERT INTO workspace_membership (id, workspace_id, user_id, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, userId, role, status);
}

function createIdGenerator(...ids) {
  let currentIndex = 0;

  return () => {
    const id = ids[currentIndex];

    if (!id) {
      throw new Error('No deterministic id available for test');
    }

    currentIndex += 1;
    return id;
  };
}

function normalizeRow(row) {
  return row ? { ...row } : row;
}

test('createMonitoringTarget saves a review-required target with ordered seed keywords', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  });

  const monitoringTarget = createMonitoringTarget({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-1',
    type: 'Company',
    displayName: ' Acme Holdings ',
    note: ' Watches the founder ',
    defaultRiskThreshold: 88,
    seedKeywords: ['Acme Holdings', 'Chairman Acme'],
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('target-1', 'keyword-1', 'keyword-2'),
  });

  const savedTarget = db
    .prepare(`
      SELECT id, workspace_id, type, display_name, note, status, default_risk_threshold
      FROM monitoring_target
      WHERE id = ?
    `)
    .get('target-1');
  const savedKeywords = db
    .prepare(`
      SELECT id, monitoring_target_id, keyword, source_type, is_active, display_order
      FROM target_keyword
      WHERE monitoring_target_id = ?
      ORDER BY display_order
    `)
    .all('target-1')
    .map(normalizeRow);

  assert.deepEqual(monitoringTarget, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    type: 'company',
    displayName: 'Acme Holdings',
    note: 'Watches the founder',
    status: defaultMonitoringTargetStatus,
    defaultRiskThreshold: 88,
    seedKeywords: [
      {
        id: 'keyword-1',
        keyword: 'Acme Holdings',
        sourceType: 'seed',
        isActive: defaultTargetKeywordIsActive,
        displayOrder: 0,
      },
      {
        id: 'keyword-2',
        keyword: 'Chairman Acme',
        sourceType: 'seed',
        isActive: defaultTargetKeywordIsActive,
        displayOrder: 1,
      },
    ],
  });
  assert.deepEqual(normalizeRow(savedTarget), {
    id: 'target-1',
    workspace_id: 'workspace-1',
    type: 'company',
    display_name: 'Acme Holdings',
    note: 'Watches the founder',
    status: defaultMonitoringTargetStatus,
    default_risk_threshold: 88,
  });
  assert.deepEqual(savedKeywords, [
    {
      id: 'keyword-1',
      monitoring_target_id: 'target-1',
      keyword: 'Acme Holdings',
      source_type: 'seed',
      is_active: defaultTargetKeywordIsActive,
      display_order: 0,
    },
    {
      id: 'keyword-2',
      monitoring_target_id: 'target-1',
      keyword: 'Chairman Acme',
      source_type: 'seed',
      is_active: defaultTargetKeywordIsActive,
      display_order: 1,
    },
  ]);

  db.close();
});

test('createMonitoringTarget rejects requests without a seed keyword', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  });

  assert.throws(
    () =>
      createMonitoringTarget({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-1',
        type: 'company',
        displayName: 'Acme Holdings',
        seedKeywords: [],
      }),
    (error) => {
      assert.ok(error instanceof MonitoringTargetServiceError);
      assert.equal(error.code, 'MONITORING_TARGET_SEED_KEYWORD_REQUIRED');
      return true;
    },
  );

  db.close();
});

test('createMonitoringTarget requires an active workspace membership', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    status: 'suspended',
  });

  assert.throws(
    () =>
      createMonitoringTarget({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-1',
        type: 'company',
        displayName: 'Acme Holdings',
        seedKeywords: ['Acme Holdings'],
      }),
    (error) => {
      assert.ok(error instanceof MonitoringTargetServiceError);
      assert.equal(error.code, 'WORKSPACE_MEMBER_FORBIDDEN');
      return true;
    },
  );

  db.close();
});

test('createMonitoringTarget applies the shared default threshold and normalizes blank notes', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  });

  const monitoringTarget = createMonitoringTarget({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-1',
    type: 'person',
    displayName: 'Jane Doe',
    note: '   ',
    seedKeywords: ['Jane Doe'],
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('target-1', 'keyword-1'),
  });

  const savedTarget = db
    .prepare(`
      SELECT note, status, default_risk_threshold
      FROM monitoring_target
      WHERE id = ?
    `)
    .get('target-1');

  assert.equal(monitoringTarget.note, null);
  assert.equal(monitoringTarget.status, defaultMonitoringTargetStatus);
  assert.equal(monitoringTarget.defaultRiskThreshold, defaultMonitoringTargetRiskThreshold);
  assert.deepEqual(normalizeRow(savedTarget), {
    note: null,
    status: defaultMonitoringTargetStatus,
    default_risk_threshold: defaultMonitoringTargetRiskThreshold,
  });

  db.close();
});
