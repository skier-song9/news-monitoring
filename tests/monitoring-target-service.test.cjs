'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  MonitoringTargetServiceError,
  activateMonitoringTarget,
  createMonitoringTarget,
  saveMonitoringTargetReviewDecision,
} = require('../src/backend/monitoring-target-service.cjs');
const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  activeMonitoringTargetStatus,
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetAwaitingActivationStatus,
  monitoringTargetReadyForReviewStatus,
} = require('../src/db/schema/monitoring-target.cjs');
const {
  monitoringTargetMatchReviewDecision,
  monitoringTargetMismatchReviewDecision,
  monitoringTargetPartialMatchReviewDecision,
} = require('../src/db/schema/monitoring-target-review.cjs');
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

function insertMonitoringTarget(
  db,
  {
    id,
    workspaceId,
    type = 'company',
    displayName,
    note = null,
    status = defaultMonitoringTargetStatus,
    defaultRiskThreshold = defaultMonitoringTargetRiskThreshold,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target (
      id,
      workspace_id,
      type,
      display_name,
      note,
      status,
      default_risk_threshold
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, type, displayName, note, status, defaultRiskThreshold);
}

function insertReview(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    reviewDecision,
    reviewedByMembershipId,
    reviewedAt,
    activatedByMembershipId = null,
    activatedAt = null,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target_review (
      id,
      workspace_id,
      monitoring_target_id,
      review_decision,
      reviewed_by_membership_id,
      reviewed_at,
      activated_by_membership_id,
      activated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    reviewDecision,
    reviewedByMembershipId,
    reviewedAt,
    activatedByMembershipId,
    activatedAt,
  );
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

test('saveMonitoringTargetReviewDecision persists a match review and leaves the target awaiting activation', () => {
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
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: monitoringTargetReadyForReviewStatus,
  });

  const review = saveMonitoringTargetReviewDecision({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    userId: 'user-1',
    decision: ' Match ',
    now: () => '2026-03-30T13:00:00.000Z',
    createId: createIdGenerator('review-1'),
  });

  const savedTarget = db
    .prepare(`
      SELECT status
      FROM monitoring_target
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'target-1');
  const savedReview = db
    .prepare(`
      SELECT id, review_decision, reviewed_by_membership_id, reviewed_at, activated_by_membership_id, activated_at
      FROM monitoring_target_review
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');

  assert.deepEqual(review, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetMatchReviewDecision,
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T13:00:00.000Z',
    status: monitoringTargetAwaitingActivationStatus,
  });
  assert.deepEqual(normalizeRow(savedTarget), {
    status: monitoringTargetAwaitingActivationStatus,
  });
  assert.deepEqual(normalizeRow(savedReview), {
    id: 'review-1',
    review_decision: monitoringTargetMatchReviewDecision,
    reviewed_by_membership_id: 'membership-1',
    reviewed_at: '2026-03-30T13:00:00.000Z',
    activated_by_membership_id: null,
    activated_at: null,
  });

  db.close();
});

test('saveMonitoringTargetReviewDecision reopens a mismatched target for keyword editing', () => {
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
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: monitoringTargetAwaitingActivationStatus,
  });
  insertReview(db, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetPartialMatchReviewDecision,
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T12:00:00.000Z',
  });

  const review = saveMonitoringTargetReviewDecision({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    userId: 'user-1',
    decision: monitoringTargetMismatchReviewDecision,
    now: () => '2026-03-30T13:15:00.000Z',
    createId: createIdGenerator('unused-review-id'),
  });

  const savedTarget = db
    .prepare(`
      SELECT status
      FROM monitoring_target
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'target-1');
  const savedReview = db
    .prepare(`
      SELECT id, review_decision, reviewed_at, activated_by_membership_id, activated_at
      FROM monitoring_target_review
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');

  assert.deepEqual(review, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetMismatchReviewDecision,
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T13:15:00.000Z',
    status: defaultMonitoringTargetStatus,
  });
  assert.deepEqual(normalizeRow(savedTarget), {
    status: defaultMonitoringTargetStatus,
  });
  assert.deepEqual(normalizeRow(savedReview), {
    id: 'review-1',
    review_decision: monitoringTargetMismatchReviewDecision,
    reviewed_at: '2026-03-30T13:15:00.000Z',
    activated_by_membership_id: null,
    activated_at: null,
  });

  db.close();
});

test('activateMonitoringTarget records activation separately from review approval', () => {
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
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: monitoringTargetAwaitingActivationStatus,
  });
  insertReview(db, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetPartialMatchReviewDecision,
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T12:00:00.000Z',
  });

  const activation = activateMonitoringTarget({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    userId: 'user-1',
    now: () => '2026-03-30T13:30:00.000Z',
  });

  const savedTarget = db
    .prepare(`
      SELECT status
      FROM monitoring_target
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'target-1');
  const savedReview = db
    .prepare(`
      SELECT review_decision, activated_by_membership_id, activated_at
      FROM monitoring_target_review
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');

  assert.deepEqual(activation, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetPartialMatchReviewDecision,
    activatedByMembershipId: 'membership-1',
    activatedAt: '2026-03-30T13:30:00.000Z',
    status: activeMonitoringTargetStatus,
  });
  assert.deepEqual(normalizeRow(savedTarget), {
    status: activeMonitoringTargetStatus,
  });
  assert.deepEqual(normalizeRow(savedReview), {
    review_decision: monitoringTargetPartialMatchReviewDecision,
    activated_by_membership_id: 'membership-1',
    activated_at: '2026-03-30T13:30:00.000Z',
  });

  db.close();
});

test('activateMonitoringTarget rejects targets without an approval review decision', () => {
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
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: monitoringTargetAwaitingActivationStatus,
  });
  insertReview(db, {
    id: 'review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: monitoringTargetMismatchReviewDecision,
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T12:00:00.000Z',
  });

  assert.throws(
    () =>
      activateMonitoringTarget({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-1',
      }),
    (error) => {
      assert.ok(error instanceof MonitoringTargetServiceError);
      assert.equal(error.code, 'MONITORING_TARGET_REVIEW_DECISION_INVALID');
      return true;
    },
  );

  db.close();
});
