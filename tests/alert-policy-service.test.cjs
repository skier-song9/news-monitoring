'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  AlertPolicyServiceError,
  resolveEffectiveAlertPolicy,
  saveTargetAlertPolicy,
  saveWorkspaceAlertPolicy,
} = require('../src/backend/alert-policy-service.cjs');

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
    defaultRiskThreshold = 70,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target (
      id,
      workspace_id,
      type,
      display_name,
      default_risk_threshold
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, type, displayName, defaultRiskThreshold);
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

test('saveWorkspaceAlertPolicy upserts a workspace policy with normalized destinations', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-owner',
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    role: 'owner',
  });

  const savedPolicy = saveWorkspaceAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    riskThreshold: 82,
    slackEnabled: true,
    slackWebhookUrl: ' https://hooks.slack.com/services/T000/B000/ABC123 ',
    emailEnabled: true,
    emailRecipients: ['Ops@example.com', 'ops@example.com', ' legal@example.com '],
    smsEnabled: true,
    smsRecipients: '+12025550100,\n+12025550101',
    now: () => '2026-03-30T14:00:00.000Z',
    createId: createIdGenerator('policy-workspace-1'),
  });

  const persistedPolicy = db
    .prepare(`
      SELECT
        id,
        workspace_id,
        monitoring_target_id,
        risk_threshold,
        slack_enabled,
        slack_webhook_url,
        email_enabled,
        email_recipients,
        sms_enabled,
        sms_recipients
      FROM alert_policy
      WHERE id = ?
    `)
    .get('policy-workspace-1');

  assert.deepEqual(savedPolicy, {
    id: 'policy-workspace-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: null,
    scope: 'workspace',
    riskThreshold: 82,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/ABC123',
    emailEnabled: true,
    emailRecipients: ['ops@example.com', 'legal@example.com'],
    smsEnabled: true,
    smsRecipients: ['+12025550100', '+12025550101'],
  });
  assert.deepEqual(normalizeRow(persistedPolicy), {
    id: 'policy-workspace-1',
    workspace_id: 'workspace-1',
    monitoring_target_id: null,
    risk_threshold: 82,
    slack_enabled: 1,
    slack_webhook_url: 'https://hooks.slack.com/services/T000/B000/ABC123',
    email_enabled: 1,
    email_recipients: '["ops@example.com","legal@example.com"]',
    sms_enabled: 1,
    sms_recipients: '["+12025550100","+12025550101"]',
  });

  const updatedPolicy = saveWorkspaceAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    riskThreshold: 76,
    smsEnabled: false,
    smsRecipients: [],
    now: () => '2026-03-30T14:05:00.000Z',
  });

  assert.deepEqual(updatedPolicy, {
    id: 'policy-workspace-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: null,
    scope: 'workspace',
    riskThreshold: 76,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/ABC123',
    emailEnabled: true,
    emailRecipients: ['ops@example.com', 'legal@example.com'],
    smsEnabled: false,
    smsRecipients: [],
  });

  db.close();
});

test('alert policy writes require an active workspace admin', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-member',
    email: 'member@example.com',
    displayName: 'Member',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-member',
    workspaceId: 'workspace-1',
    userId: 'user-member',
    role: 'member',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });

  assert.throws(
    () =>
      saveWorkspaceAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        riskThreshold: 80,
      }),
    (error) => {
      assert.ok(error instanceof AlertPolicyServiceError);
      assert.equal(error.code, 'WORKSPACE_ADMIN_FORBIDDEN');
      return true;
    },
  );

  assert.throws(
    () =>
      saveTargetAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-member',
        riskThreshold: 85,
      }),
    (error) => {
      assert.ok(error instanceof AlertPolicyServiceError);
      assert.equal(error.code, 'WORKSPACE_ADMIN_FORBIDDEN');
      return true;
    },
  );

  db.close();
});

test('saveTargetAlertPolicy validates channel destinations before saving', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-owner',
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    role: 'owner',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });

  assert.throws(
    () =>
      saveTargetAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-owner',
        slackEnabled: true,
        slackWebhookUrl: 'https://example.com/not-slack',
      }),
    /slackWebhookUrl must be a valid Slack webhook URL/u,
  );

  assert.throws(
    () =>
      saveTargetAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-owner',
        emailEnabled: true,
        emailRecipients: ['not-an-email'],
      }),
    /emailRecipients contains an invalid email address/u,
  );

  assert.throws(
    () =>
      saveTargetAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-owner',
        smsEnabled: true,
        smsRecipients: ['202-555-0100'],
      }),
    /smsRecipients contains an invalid E\.164 phone number/u,
  );

  assert.throws(
    () =>
      saveTargetAlertPolicy({
        db,
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        userId: 'user-owner',
        emailEnabled: true,
        emailRecipients: [],
      }),
    /emailRecipients is required when emailEnabled is true/u,
  );

  db.close();
});

test('resolveEffectiveAlertPolicy prefers target overrides over workspace defaults', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-owner',
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    role: 'owner',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    defaultRiskThreshold: 72,
  });
  insertMonitoringTarget(db, {
    id: 'target-2',
    workspaceId: 'workspace-1',
    displayName: 'Beta Capital',
    defaultRiskThreshold: 64,
  });

  saveWorkspaceAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    riskThreshold: 78,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/WORKSPACE',
    emailEnabled: true,
    emailRecipients: ['desk@example.com'],
    smsEnabled: false,
    createId: createIdGenerator('policy-workspace-1'),
    now: () => '2026-03-30T15:00:00.000Z',
  });

  saveTargetAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    userId: 'user-owner',
    riskThreshold: 91,
    slackEnabled: false,
    slackWebhookUrl: '',
    emailEnabled: true,
    emailRecipients: ['target-owner@example.com'],
    smsEnabled: true,
    smsRecipients: ['+12025550111'],
    createId: createIdGenerator('policy-target-1'),
    now: () => '2026-03-30T15:05:00.000Z',
  });

  const targetPolicy = resolveEffectiveAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
  });
  const inheritedWorkspacePolicy = resolveEffectiveAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-2',
  });

  assert.deepEqual(targetPolicy, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    scope: 'target',
    riskThreshold: 91,
    slackEnabled: false,
    slackWebhookUrl: null,
    emailEnabled: true,
    emailRecipients: ['target-owner@example.com'],
    smsEnabled: true,
    smsRecipients: ['+12025550111'],
  });
  assert.deepEqual(inheritedWorkspacePolicy, {
    id: 'policy-workspace-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: null,
    scope: 'workspace',
    riskThreshold: 78,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/WORKSPACE',
    emailEnabled: true,
    emailRecipients: ['desk@example.com'],
    smsEnabled: false,
    smsRecipients: [],
  });

  db.close();
});

test('resolveEffectiveAlertPolicy falls back to a target threshold when no alert policy exists', () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    defaultRiskThreshold: 83,
  });

  const effectivePolicy = resolveEffectiveAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
  });

  assert.deepEqual(effectivePolicy, {
    id: null,
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    scope: 'monitoring_target_default',
    riskThreshold: 83,
    slackEnabled: false,
    slackWebhookUrl: null,
    emailEnabled: false,
    emailRecipients: [],
    smsEnabled: false,
    smsRecipients: [],
  });

  db.close();
});
