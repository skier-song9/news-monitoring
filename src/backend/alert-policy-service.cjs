'use strict';

const { randomUUID } = require('node:crypto');

const { alertPolicyDefaultThreshold } = require('../db/schema/analysis-alert.cjs');
const { workspaceAdminRoles } = require('../db/schema/workspace.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const SLACK_WEBHOOK_HOSTS = new Set(['hooks.slack.com', 'hooks.slack-gov.com']);
const EMAIL_RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SMS_RECIPIENT_PATTERN = /^\+[1-9]\d{7,14}$/u;

class AlertPolicyServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AlertPolicyServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new AlertPolicyServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new AlertPolicyServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AlertPolicyServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeRiskThreshold(riskThreshold) {
  if (riskThreshold == null) {
    return alertPolicyDefaultThreshold;
  }

  if (!Number.isInteger(riskThreshold) || riskThreshold < 0 || riskThreshold > 100) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'riskThreshold must be an integer between 0 and 100',
    );
  }

  return riskThreshold;
}

function normalizeEnabledFlag(value, fieldName) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 0 || value === 1) {
    return Boolean(value);
  }

  throw new AlertPolicyServiceError(
    'INVALID_INPUT',
    `${fieldName} must be a boolean or 0/1 integer`,
  );
}

function normalizeSlackWebhookUrl(value) {
  const normalizedValue = normalizeOptionalString(value, 'slackWebhookUrl');

  if (!normalizedValue) {
    return null;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'slackWebhookUrl must be a valid Slack webhook URL',
    );
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    !SLACK_WEBHOOK_HOSTS.has(parsedUrl.hostname) ||
    !parsedUrl.pathname.startsWith('/services/')
  ) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'slackWebhookUrl must be a valid Slack webhook URL',
    );
  }

  return parsedUrl.toString();
}

function splitRecipientString(value) {
  return value
    .split(/[\n,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRecipientList(value, fieldName) {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string') {
    return splitRecipientString(value);
  }

  if (!Array.isArray(value)) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      `${fieldName} must be a string or an array`,
    );
  }

  return value.map((entry, index) => normalizeRequiredString(entry, `${fieldName}[${index}]`));
}

function normalizeEmailRecipients(value) {
  const normalizedRecipients = normalizeRecipientList(value, 'emailRecipients');
  const dedupedRecipients = [];
  const seenRecipients = new Set();

  for (const recipient of normalizedRecipients) {
    const normalizedRecipient = recipient.toLowerCase();

    if (!EMAIL_RECIPIENT_PATTERN.test(normalizedRecipient)) {
      throw new AlertPolicyServiceError(
        'INVALID_INPUT',
        `emailRecipients contains an invalid email address: ${recipient}`,
      );
    }

    if (seenRecipients.has(normalizedRecipient)) {
      continue;
    }

    seenRecipients.add(normalizedRecipient);
    dedupedRecipients.push(normalizedRecipient);
  }

  return dedupedRecipients;
}

function normalizeSmsRecipients(value) {
  const normalizedRecipients = normalizeRecipientList(value, 'smsRecipients');
  const dedupedRecipients = [];
  const seenRecipients = new Set();

  for (const recipient of normalizedRecipients) {
    if (!SMS_RECIPIENT_PATTERN.test(recipient)) {
      throw new AlertPolicyServiceError(
        'INVALID_INPUT',
        `smsRecipients contains an invalid E.164 phone number: ${recipient}`,
      );
    }

    if (seenRecipients.has(recipient)) {
      continue;
    }

    seenRecipients.add(recipient);
    dedupedRecipients.push(recipient);
  }

  return dedupedRecipients;
}

function serializeRecipients(recipients) {
  return recipients.length > 0 ? JSON.stringify(recipients) : null;
}

function parseStoredRecipients(value) {
  if (value == null) {
    return [];
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value);

    if (Array.isArray(parsedValue)) {
      return parsedValue;
    }
  } catch {
    return splitRecipientString(value);
  }

  return splitRecipientString(value);
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultCreateId() {
  return randomUUID();
}

function runInTransaction(db, callback) {
  db.exec('BEGIN');

  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures because the original error is the actionable one.
    }

    throw error;
  }
}

function hasOwnValue(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function getWorkspace(db, workspaceId) {
  return db
    .prepare(`
      SELECT id, slug, name
      FROM workspace
      WHERE id = ?
    `)
    .get(workspaceId);
}

function getMembership(db, workspaceId, userId) {
  return db
    .prepare(`
      SELECT id, role, status
      FROM workspace_membership
      WHERE workspace_id = ? AND user_id = ?
    `)
    .get(workspaceId, userId);
}

function getMonitoringTarget(db, workspaceId, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id, workspace_id, default_risk_threshold
      FROM monitoring_target
      WHERE workspace_id = ? AND id = ?
    `)
    .get(workspaceId, monitoringTargetId);
}

function listMonitoringTargets(db, workspaceId) {
  return db
    .prepare(`
      SELECT
        id,
        workspace_id,
        type,
        display_name,
        note,
        status,
        default_risk_threshold
      FROM monitoring_target
      WHERE workspace_id = ?
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'awaiting_activation' THEN 1
          WHEN 'ready_for_review' THEN 2
          ELSE 3
        END,
        display_name COLLATE NOCASE,
        id
    `)
    .all(workspaceId);
}

function getAlertPolicyRow(db, workspaceId, monitoringTargetId) {
  if (monitoringTargetId == null) {
    return db
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
        WHERE workspace_id = ?
          AND monitoring_target_id IS NULL
      `)
      .get(workspaceId);
  }

  return db
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
      WHERE workspace_id = ?
        AND monitoring_target_id = ?
    `)
    .get(workspaceId, monitoringTargetId);
}

function createDefaultPolicyConfig(riskThreshold = alertPolicyDefaultThreshold) {
  return {
    riskThreshold,
    slackEnabled: false,
    slackWebhookUrl: null,
    emailEnabled: false,
    emailRecipients: [],
    smsEnabled: false,
    smsRecipients: [],
  };
}

function normalizeStoredPolicyRow(row) {
  return {
    riskThreshold: row.risk_threshold,
    slackEnabled: Boolean(row.slack_enabled),
    slackWebhookUrl: normalizeSlackWebhookUrl(row.slack_webhook_url),
    emailEnabled: Boolean(row.email_enabled),
    emailRecipients: normalizeEmailRecipients(parseStoredRecipients(row.email_recipients)),
    smsEnabled: Boolean(row.sms_enabled),
    smsRecipients: normalizeSmsRecipients(parseStoredRecipients(row.sms_recipients)),
  };
}

function toAlertPolicyRecord(row, scope) {
  const policy = normalizeStoredPolicyRow(row);

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    monitoringTargetId: row.monitoring_target_id,
    scope,
    riskThreshold: policy.riskThreshold,
    slackEnabled: policy.slackEnabled,
    slackWebhookUrl: policy.slackWebhookUrl,
    emailEnabled: policy.emailEnabled,
    emailRecipients: policy.emailRecipients,
    smsEnabled: policy.smsEnabled,
    smsRecipients: policy.smsRecipients,
  };
}

function toResolvedAlertPolicyRecord({
  workspaceId,
  monitoringTargetId,
  resolvedPolicy,
}) {
  if (resolvedPolicy.policyRow) {
    return toAlertPolicyRecord(resolvedPolicy.policyRow, resolvedPolicy.scope);
  }

  return {
    id: null,
    workspaceId,
    monitoringTargetId:
      resolvedPolicy.scope === 'monitoring_target_default' ? monitoringTargetId : null,
    scope: resolvedPolicy.scope,
    riskThreshold: resolvedPolicy.policy.riskThreshold,
    slackEnabled: resolvedPolicy.policy.slackEnabled,
    slackWebhookUrl: resolvedPolicy.policy.slackWebhookUrl,
    emailEnabled: resolvedPolicy.policy.emailEnabled,
    emailRecipients: resolvedPolicy.policy.emailRecipients,
    smsEnabled: resolvedPolicy.policy.smsEnabled,
    smsRecipients: resolvedPolicy.policy.smsRecipients,
  };
}

function requireActiveWorkspaceAdmin(db, workspaceId, userId) {
  const membership = getMembership(db, workspaceId, userId);

  if (
    !membership ||
    membership.status !== ACTIVE_MEMBERSHIP_STATUS ||
    !workspaceAdminRoles.includes(membership.role)
  ) {
    throw new AlertPolicyServiceError(
      'WORKSPACE_ADMIN_FORBIDDEN',
      'Only active workspace admins can manage alert policies',
    );
  }

  return membership;
}

function getAlertSettingsPage({
  db,
  workspaceId,
  userId,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(userId, 'userId');
  const workspace = getWorkspace(db, normalizedWorkspaceId);

  if (!workspace) {
    throw new AlertPolicyServiceError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
  }

  const membership = requireActiveWorkspaceAdmin(
    db,
    normalizedWorkspaceId,
    normalizedUserId,
  );
  const workspaceResolvedPolicy = resolveEffectiveAlertPolicyConfig(
    db,
    normalizedWorkspaceId,
    null,
  );
  const monitoringTargets = listMonitoringTargets(db, normalizedWorkspaceId).map(
    (monitoringTarget) => {
      const targetResolvedPolicy = resolveEffectiveAlertPolicyConfig(
        db,
        normalizedWorkspaceId,
        monitoringTarget.id,
      );

      return {
        id: monitoringTarget.id,
        workspaceId: monitoringTarget.workspace_id,
        type: monitoringTarget.type,
        displayName: monitoringTarget.display_name,
        note: monitoringTarget.note,
        status: monitoringTarget.status,
        defaultRiskThreshold: monitoringTarget.default_risk_threshold,
        effectivePolicy: toResolvedAlertPolicyRecord({
          workspaceId: normalizedWorkspaceId,
          monitoringTargetId: monitoringTarget.id,
          resolvedPolicy: targetResolvedPolicy,
        }),
      };
    },
  );

  return {
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
    },
    viewer: {
      userId: normalizedUserId,
      membershipId: membership.id,
      role: membership.role,
    },
    workspacePolicy: {
      effectivePolicy: toResolvedAlertPolicyRecord({
        workspaceId: normalizedWorkspaceId,
        monitoringTargetId: null,
        resolvedPolicy: workspaceResolvedPolicy,
      }),
    },
    monitoringTargets,
  };
}

function resolveEffectiveAlertPolicyConfig(db, workspaceId, monitoringTargetId) {
  if (monitoringTargetId != null) {
    const targetPolicyRow = getAlertPolicyRow(db, workspaceId, monitoringTargetId);

    if (targetPolicyRow) {
      return {
        scope: 'target',
        policyRow: targetPolicyRow,
        policy: normalizeStoredPolicyRow(targetPolicyRow),
      };
    }

    const workspacePolicyRow = getAlertPolicyRow(db, workspaceId, null);

    if (workspacePolicyRow) {
      return {
        scope: 'workspace',
        policyRow: workspacePolicyRow,
        policy: normalizeStoredPolicyRow(workspacePolicyRow),
      };
    }

    const monitoringTarget = getMonitoringTarget(db, workspaceId, monitoringTargetId);

    if (!monitoringTarget) {
      throw new AlertPolicyServiceError(
        'MONITORING_TARGET_NOT_FOUND',
        'Monitoring target does not exist in the workspace',
      );
    }

    return {
      scope: 'monitoring_target_default',
      policyRow: null,
      policy: createDefaultPolicyConfig(monitoringTarget.default_risk_threshold),
    };
  }

  const workspacePolicyRow = getAlertPolicyRow(db, workspaceId, null);

  if (workspacePolicyRow) {
    return {
      scope: 'workspace',
      policyRow: workspacePolicyRow,
      policy: normalizeStoredPolicyRow(workspacePolicyRow),
    };
  }

  if (!getWorkspace(db, workspaceId)) {
    throw new AlertPolicyServiceError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
  }

  return {
    scope: 'workspace_default',
    policyRow: null,
    policy: createDefaultPolicyConfig(),
  };
}

function buildNextPolicy(basePolicy, options) {
  const nextPolicy = {
    ...basePolicy,
  };

  if (hasOwnValue(options, 'riskThreshold')) {
    nextPolicy.riskThreshold = normalizeRiskThreshold(options.riskThreshold);
  }

  if (hasOwnValue(options, 'slackEnabled')) {
    nextPolicy.slackEnabled = normalizeEnabledFlag(options.slackEnabled, 'slackEnabled');
  }

  if (hasOwnValue(options, 'slackWebhookUrl')) {
    nextPolicy.slackWebhookUrl = normalizeSlackWebhookUrl(options.slackWebhookUrl);
  }

  if (hasOwnValue(options, 'emailEnabled')) {
    nextPolicy.emailEnabled = normalizeEnabledFlag(options.emailEnabled, 'emailEnabled');
  }

  if (hasOwnValue(options, 'emailRecipients')) {
    nextPolicy.emailRecipients = normalizeEmailRecipients(options.emailRecipients);
  }

  if (hasOwnValue(options, 'smsEnabled')) {
    nextPolicy.smsEnabled = normalizeEnabledFlag(options.smsEnabled, 'smsEnabled');
  }

  if (hasOwnValue(options, 'smsRecipients')) {
    nextPolicy.smsRecipients = normalizeSmsRecipients(options.smsRecipients);
  }

  if (nextPolicy.slackEnabled && !nextPolicy.slackWebhookUrl) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'slackWebhookUrl is required when slackEnabled is true',
    );
  }

  if (nextPolicy.emailEnabled && nextPolicy.emailRecipients.length === 0) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'emailRecipients is required when emailEnabled is true',
    );
  }

  if (nextPolicy.smsEnabled && nextPolicy.smsRecipients.length === 0) {
    throw new AlertPolicyServiceError(
      'INVALID_INPUT',
      'smsRecipients is required when smsEnabled is true',
    );
  }

  return nextPolicy;
}

function persistAlertPolicy({
  db,
  workspaceId,
  monitoringTargetId = null,
  existingPolicyRow,
  policy,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  return runInTransaction(db, () => {
    const updatedAt = now();

    if (existingPolicyRow) {
      db.prepare(`
        UPDATE alert_policy
        SET risk_threshold = ?,
            slack_enabled = ?,
            slack_webhook_url = ?,
            email_enabled = ?,
            email_recipients = ?,
            sms_enabled = ?,
            sms_recipients = ?,
            updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(
        policy.riskThreshold,
        policy.slackEnabled ? 1 : 0,
        policy.slackWebhookUrl,
        policy.emailEnabled ? 1 : 0,
        serializeRecipients(policy.emailRecipients),
        policy.smsEnabled ? 1 : 0,
        serializeRecipients(policy.smsRecipients),
        updatedAt,
        workspaceId,
        existingPolicyRow.id,
      );

      return getAlertPolicyRow(db, workspaceId, monitoringTargetId);
    }

    const alertPolicyId = createId();

    db.prepare(`
      INSERT INTO alert_policy (
        id,
        workspace_id,
        monitoring_target_id,
        risk_threshold,
        slack_enabled,
        slack_webhook_url,
        email_enabled,
        email_recipients,
        sms_enabled,
        sms_recipients,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alertPolicyId,
      workspaceId,
      monitoringTargetId,
      policy.riskThreshold,
      policy.slackEnabled ? 1 : 0,
      policy.slackWebhookUrl,
      policy.emailEnabled ? 1 : 0,
      serializeRecipients(policy.emailRecipients),
      policy.smsEnabled ? 1 : 0,
      serializeRecipients(policy.smsRecipients),
      updatedAt,
      updatedAt,
    );

    return getAlertPolicyRow(db, workspaceId, monitoringTargetId);
  });
}

function saveWorkspaceAlertPolicy(options) {
  const normalizedWorkspaceId = normalizeRequiredString(options.workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(options.userId, 'userId');

  requireActiveWorkspaceAdmin(options.db, normalizedWorkspaceId, normalizedUserId);

  const existingPolicyRow = getAlertPolicyRow(options.db, normalizedWorkspaceId, null);
  const basePolicy = existingPolicyRow
    ? normalizeStoredPolicyRow(existingPolicyRow)
    : createDefaultPolicyConfig();
  const nextPolicy = buildNextPolicy(basePolicy, options);
  const savedPolicyRow = persistAlertPolicy({
    db: options.db,
    workspaceId: normalizedWorkspaceId,
    existingPolicyRow,
    policy: nextPolicy,
    now: options.now,
    createId: options.createId,
  });

  return toAlertPolicyRecord(savedPolicyRow, 'workspace');
}

function saveTargetAlertPolicy(options) {
  const normalizedWorkspaceId = normalizeRequiredString(options.workspaceId, 'workspaceId');
  const normalizedMonitoringTargetId = normalizeRequiredString(
    options.monitoringTargetId,
    'monitoringTargetId',
  );
  const normalizedUserId = normalizeRequiredString(options.userId, 'userId');

  requireActiveWorkspaceAdmin(options.db, normalizedWorkspaceId, normalizedUserId);

  if (!getMonitoringTarget(options.db, normalizedWorkspaceId, normalizedMonitoringTargetId)) {
    throw new AlertPolicyServiceError(
      'MONITORING_TARGET_NOT_FOUND',
      'Monitoring target does not exist in the workspace',
    );
  }

  const existingPolicyRow = getAlertPolicyRow(
    options.db,
    normalizedWorkspaceId,
    normalizedMonitoringTargetId,
  );
  const basePolicy = existingPolicyRow
    ? normalizeStoredPolicyRow(existingPolicyRow)
    : resolveEffectiveAlertPolicyConfig(
        options.db,
        normalizedWorkspaceId,
        normalizedMonitoringTargetId,
      ).policy;
  const nextPolicy = buildNextPolicy(basePolicy, options);
  const savedPolicyRow = persistAlertPolicy({
    db: options.db,
    workspaceId: normalizedWorkspaceId,
    monitoringTargetId: normalizedMonitoringTargetId,
    existingPolicyRow,
    policy: nextPolicy,
    now: options.now,
    createId: options.createId,
  });

  return toAlertPolicyRecord(savedPolicyRow, 'target');
}

function resolveEffectiveAlertPolicy({
  db,
  workspaceId,
  monitoringTargetId,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedMonitoringTargetId = monitoringTargetId == null
    ? null
    : normalizeRequiredString(monitoringTargetId, 'monitoringTargetId');
  const effectivePolicy = resolveEffectiveAlertPolicyConfig(
    db,
    normalizedWorkspaceId,
    normalizedMonitoringTargetId,
  );

  if (effectivePolicy.policyRow) {
    return toAlertPolicyRecord(effectivePolicy.policyRow, effectivePolicy.scope);
  }

  return {
    id: null,
    workspaceId: normalizedWorkspaceId,
    monitoringTargetId:
      effectivePolicy.scope === 'monitoring_target_default'
        ? normalizedMonitoringTargetId
        : null,
    scope: effectivePolicy.scope,
    riskThreshold: effectivePolicy.policy.riskThreshold,
    slackEnabled: effectivePolicy.policy.slackEnabled,
    slackWebhookUrl: effectivePolicy.policy.slackWebhookUrl,
    emailEnabled: effectivePolicy.policy.emailEnabled,
    emailRecipients: effectivePolicy.policy.emailRecipients,
    smsEnabled: effectivePolicy.policy.smsEnabled,
    smsRecipients: effectivePolicy.policy.smsRecipients,
  };
}

module.exports = {
  AlertPolicyServiceError,
  getAlertSettingsPage,
  resolveEffectiveAlertPolicy,
  saveTargetAlertPolicy,
  saveWorkspaceAlertPolicy,
};
