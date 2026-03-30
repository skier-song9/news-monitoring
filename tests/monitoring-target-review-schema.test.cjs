'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  monitoringTargetMatchReviewDecision,
  monitoringTargetMismatchReviewDecision,
  monitoringTargetPartialMatchReviewDecision,
  monitoringTargetReviewDecisions,
} = require('../src/db/schema/monitoring-target-review.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function seedWorkspace(db) {
  db.exec(`
    INSERT INTO user_account (id, email, display_name)
    VALUES ('user-1', 'owner@example.com', 'Owner');

    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme-risk', 'Acme Risk Desk');

    INSERT INTO workspace_membership (id, workspace_id, user_id, role, status)
    VALUES ('membership-1', 'workspace-1', 'user-1', 'owner', 'active');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name, status)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings', 'ready_for_review');
  `);
}

test('monitoring_target_review enforces one review row per target and paired activation metadata', () => {
  const db = createDatabase();
  seedWorkspace(db);

  db.exec(`
    INSERT INTO monitoring_target_review (
      id,
      workspace_id,
      monitoring_target_id,
      review_decision,
      reviewed_by_membership_id,
      reviewed_at
    )
    VALUES (
      'review-1',
      'workspace-1',
      'target-1',
      'match',
      'membership-1',
      '2026-03-30T13:00:00.000Z'
    );
  `);

  db.exec(`
    INSERT INTO monitoring_target (id, workspace_id, type, display_name, status)
    VALUES ('target-2', 'workspace-1', 'company', 'Acme Subsidiary', 'ready_for_review');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_review (
          id,
          workspace_id,
          monitoring_target_id,
          review_decision,
          reviewed_by_membership_id,
          reviewed_at
        )
        VALUES (
          'review-2',
          'workspace-1',
          'target-1',
          'partial_match',
          'membership-1',
          '2026-03-30T13:05:00.000Z'
        );
      `),
    /UNIQUE constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_review (
          id,
          workspace_id,
          monitoring_target_id,
          review_decision,
          reviewed_by_membership_id,
          reviewed_at,
          activated_at
        )
        VALUES (
          'review-3',
          'workspace-1',
          'target-2',
          'match',
          'membership-1',
          '2026-03-30T13:10:00.000Z',
          '2026-03-30T13:15:00.000Z'
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('monitoring_target_review enforces workspace-scoped foreign keys and review decisions', () => {
  const db = createDatabase();
  seedWorkspace(db);

  db.exec(`
    INSERT INTO user_account (id, email, display_name)
    VALUES ('user-2', 'other@example.com', 'Other');

    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-2', 'other-risk', 'Other Risk Desk');

    INSERT INTO workspace_membership (id, workspace_id, user_id, role, status)
    VALUES ('membership-2', 'workspace-2', 'user-2', 'owner', 'active');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_review (
          id,
          workspace_id,
          monitoring_target_id,
          review_decision,
          reviewed_by_membership_id,
          reviewed_at
        )
        VALUES (
          'review-cross-workspace',
          'workspace-1',
          'target-1',
          'match',
          'membership-2',
          '2026-03-30T13:00:00.000Z'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO monitoring_target_review (
          id,
          workspace_id,
          monitoring_target_id,
          review_decision,
          reviewed_by_membership_id,
          reviewed_at
        )
        VALUES (
          'review-invalid-decision',
          'workspace-1',
          'target-1',
          'approved',
          'membership-1',
          '2026-03-30T13:00:00.000Z'
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('monitoring target review constants match the migration contract', () => {
  assert.deepEqual(monitoringTargetReviewDecisions, [
    monitoringTargetMatchReviewDecision,
    monitoringTargetPartialMatchReviewDecision,
    monitoringTargetMismatchReviewDecision,
  ]);
  assert.equal(monitoringTargetMatchReviewDecision, 'match');
  assert.equal(monitoringTargetPartialMatchReviewDecision, 'partial_match');
  assert.equal(monitoringTargetMismatchReviewDecision, 'mismatch');
});
