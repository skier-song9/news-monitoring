'use strict';

const { randomUUID } = require('node:crypto');

const {
  activeMonitoringTargetStatus,
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetAwaitingActivationStatus,
  monitoringTargetReadyForReviewStatus,
  monitoringTargetTypes,
} = require('../db/schema/monitoring-target.cjs');
const {
  monitoringTargetMatchReviewDecision,
  monitoringTargetMismatchReviewDecision,
  monitoringTargetPartialMatchReviewDecision,
  monitoringTargetReviewDecisions,
} = require('../db/schema/monitoring-target-review.cjs');
const {
  defaultTargetKeywordIsActive,
  seedTargetKeywordSourceType,
} = require('../db/schema/target-keyword.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';

class MonitoringTargetServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MonitoringTargetServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new MonitoringTargetServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new MonitoringTargetServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new MonitoringTargetServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeMonitoringTargetType(type) {
  const normalizedType = normalizeRequiredString(type, 'type').toLowerCase();

  if (!monitoringTargetTypes.includes(normalizedType)) {
    throw new MonitoringTargetServiceError(
      'INVALID_INPUT',
      `type must be one of: ${monitoringTargetTypes.join(', ')}`,
    );
  }

  return normalizedType;
}

function normalizeRiskThreshold(defaultRiskThreshold) {
  if (defaultRiskThreshold == null) {
    return defaultMonitoringTargetRiskThreshold;
  }

  if (
    !Number.isInteger(defaultRiskThreshold) ||
    defaultRiskThreshold < 0 ||
    defaultRiskThreshold > 100
  ) {
    throw new MonitoringTargetServiceError(
      'INVALID_INPUT',
      'defaultRiskThreshold must be an integer between 0 and 100',
    );
  }

  return defaultRiskThreshold;
}

function normalizeSeedKeywords(seedKeywords) {
  if (!Array.isArray(seedKeywords)) {
    throw new MonitoringTargetServiceError('INVALID_INPUT', 'seedKeywords must be an array');
  }

  if (seedKeywords.length === 0) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_SEED_KEYWORD_REQUIRED',
      'At least one seed keyword is required',
    );
  }

  return seedKeywords.map((keyword, index) =>
    normalizeRequiredString(keyword, `seedKeywords[${index}]`),
  );
}

function normalizeMonitoringTargetReviewDecision(decision) {
  const normalizedDecision = normalizeRequiredString(decision, 'decision').toLowerCase();

  if (!monitoringTargetReviewDecisions.includes(normalizedDecision)) {
    throw new MonitoringTargetServiceError(
      'INVALID_INPUT',
      `decision must be one of: ${monitoringTargetReviewDecisions.join(', ')}`,
    );
  }

  return normalizedDecision;
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

function getMembership(db, workspaceId, userId) {
  return db
    .prepare(`
      SELECT id, status
      FROM workspace_membership
      WHERE workspace_id = ? AND user_id = ?
    `)
    .get(workspaceId, userId);
}

function getMonitoringTarget(db, workspaceId, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id, workspace_id, status
      FROM monitoring_target
      WHERE workspace_id = ? AND id = ?
    `)
    .get(workspaceId, monitoringTargetId);
}

function getMonitoringTargetReview(db, workspaceId, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id, review_decision, reviewed_by_membership_id, reviewed_at, activated_by_membership_id, activated_at
      FROM monitoring_target_review
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get(workspaceId, monitoringTargetId);
}

function updateMonitoringTargetStatus(db, workspaceId, monitoringTargetId, status, updatedAt) {
  db.prepare(`
    UPDATE monitoring_target
    SET status = ?, updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(status, updatedAt, workspaceId, monitoringTargetId);
}

function createMonitoringTarget({
  db,
  workspaceId,
  userId,
  type,
  displayName,
  note,
  defaultRiskThreshold,
  seedKeywords,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(userId, 'userId');
  const normalizedType = normalizeMonitoringTargetType(type);
  const normalizedDisplayName = normalizeRequiredString(displayName, 'displayName');
  const normalizedNote = normalizeOptionalString(note, 'note');
  const normalizedRiskThreshold = normalizeRiskThreshold(defaultRiskThreshold);
  const normalizedSeedKeywords = normalizeSeedKeywords(seedKeywords);

  const membership = getMembership(db, normalizedWorkspaceId, normalizedUserId);

  if (!membership || membership.status !== ACTIVE_MEMBERSHIP_STATUS) {
    throw new MonitoringTargetServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can create monitoring targets',
    );
  }

  return runInTransaction(db, () => {
    const createdAt = now();
    const monitoringTargetId = createId();

    db.prepare(`
      INSERT INTO monitoring_target (
        id,
        workspace_id,
        type,
        display_name,
        note,
        status,
        default_risk_threshold,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      monitoringTargetId,
      normalizedWorkspaceId,
      normalizedType,
      normalizedDisplayName,
      normalizedNote,
      defaultMonitoringTargetStatus,
      normalizedRiskThreshold,
      createdAt,
      createdAt,
    );

    const createdSeedKeywords = normalizedSeedKeywords.map((keyword, displayOrder) => {
      const keywordId = createId();

      db.prepare(`
        INSERT INTO target_keyword (
          id,
          monitoring_target_id,
          keyword,
          source_type,
          is_active,
          display_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        keywordId,
        monitoringTargetId,
        keyword,
        seedTargetKeywordSourceType,
        defaultTargetKeywordIsActive,
        displayOrder,
        createdAt,
        createdAt,
      );

      return {
        id: keywordId,
        keyword,
        sourceType: seedTargetKeywordSourceType,
        isActive: defaultTargetKeywordIsActive,
        displayOrder,
      };
    });

    return {
      id: monitoringTargetId,
      workspaceId: normalizedWorkspaceId,
      type: normalizedType,
      displayName: normalizedDisplayName,
      note: normalizedNote,
      status: defaultMonitoringTargetStatus,
      defaultRiskThreshold: normalizedRiskThreshold,
      seedKeywords: createdSeedKeywords,
    };
  });
}

function saveMonitoringTargetReviewDecision({
  db,
  workspaceId,
  monitoringTargetId,
  userId,
  decision,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedMonitoringTargetId = normalizeRequiredString(
    monitoringTargetId,
    'monitoringTargetId',
  );
  const normalizedUserId = normalizeRequiredString(userId, 'userId');
  const normalizedDecision = normalizeMonitoringTargetReviewDecision(decision);

  const membership = getMembership(db, normalizedWorkspaceId, normalizedUserId);

  if (!membership || membership.status !== ACTIVE_MEMBERSHIP_STATUS) {
    throw new MonitoringTargetServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can review monitoring targets',
    );
  }

  const monitoringTarget = getMonitoringTarget(
    db,
    normalizedWorkspaceId,
    normalizedMonitoringTargetId,
  );

  if (!monitoringTarget) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_NOT_FOUND',
      'Monitoring target does not exist in the workspace',
    );
  }

  if (
    monitoringTarget.status !== monitoringTargetReadyForReviewStatus &&
    monitoringTarget.status !== monitoringTargetAwaitingActivationStatus
  ) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_STATUS_INVALID',
      `Monitoring target status ${monitoringTarget.status} cannot save a review decision`,
    );
  }

  return runInTransaction(db, () => {
    const reviewedAt = now();
    const nextStatus =
      normalizedDecision === monitoringTargetMismatchReviewDecision
        ? defaultMonitoringTargetStatus
        : monitoringTargetAwaitingActivationStatus;
    const existingReview = getMonitoringTargetReview(
      db,
      normalizedWorkspaceId,
      normalizedMonitoringTargetId,
    );
    const reviewId = existingReview ? existingReview.id : createId();

    db.prepare(`
      INSERT INTO monitoring_target_review (
        id,
        workspace_id,
        monitoring_target_id,
        review_decision,
        reviewed_by_membership_id,
        reviewed_at,
        activated_by_membership_id,
        activated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT (workspace_id, monitoring_target_id) DO UPDATE SET
        review_decision = excluded.review_decision,
        reviewed_by_membership_id = excluded.reviewed_by_membership_id,
        reviewed_at = excluded.reviewed_at,
        activated_by_membership_id = NULL,
        activated_at = NULL,
        updated_at = excluded.updated_at
    `).run(
      reviewId,
      normalizedWorkspaceId,
      normalizedMonitoringTargetId,
      normalizedDecision,
      membership.id,
      reviewedAt,
      reviewedAt,
      reviewedAt,
    );

    updateMonitoringTargetStatus(
      db,
      normalizedWorkspaceId,
      normalizedMonitoringTargetId,
      nextStatus,
      reviewedAt,
    );

    return {
      id: reviewId,
      workspaceId: normalizedWorkspaceId,
      monitoringTargetId: normalizedMonitoringTargetId,
      reviewDecision: normalizedDecision,
      reviewedByMembershipId: membership.id,
      reviewedAt,
      status: nextStatus,
    };
  });
}

function activateMonitoringTarget({
  db,
  workspaceId,
  monitoringTargetId,
  userId,
  now = defaultNow,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedMonitoringTargetId = normalizeRequiredString(
    monitoringTargetId,
    'monitoringTargetId',
  );
  const normalizedUserId = normalizeRequiredString(userId, 'userId');

  const membership = getMembership(db, normalizedWorkspaceId, normalizedUserId);

  if (!membership || membership.status !== ACTIVE_MEMBERSHIP_STATUS) {
    throw new MonitoringTargetServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can activate monitoring targets',
    );
  }

  const monitoringTarget = getMonitoringTarget(
    db,
    normalizedWorkspaceId,
    normalizedMonitoringTargetId,
  );

  if (!monitoringTarget) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_NOT_FOUND',
      'Monitoring target does not exist in the workspace',
    );
  }

  if (monitoringTarget.status !== monitoringTargetAwaitingActivationStatus) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_STATUS_INVALID',
      `Monitoring target status ${monitoringTarget.status} cannot be activated`,
    );
  }

  const review = getMonitoringTargetReview(
    db,
    normalizedWorkspaceId,
    normalizedMonitoringTargetId,
  );

  if (!review) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_REVIEW_REQUIRED',
      'A saved review decision is required before activation',
    );
  }

  if (
    review.review_decision !== monitoringTargetMatchReviewDecision &&
    review.review_decision !== monitoringTargetPartialMatchReviewDecision
  ) {
    throw new MonitoringTargetServiceError(
      'MONITORING_TARGET_REVIEW_DECISION_INVALID',
      'Only match or partial_match review decisions can be activated',
    );
  }

  return runInTransaction(db, () => {
    const activatedAt = now();

    db.prepare(`
      UPDATE monitoring_target_review
      SET activated_by_membership_id = ?,
          activated_at = ?,
          updated_at = ?
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `).run(
      membership.id,
      activatedAt,
      activatedAt,
      normalizedWorkspaceId,
      normalizedMonitoringTargetId,
    );

    updateMonitoringTargetStatus(
      db,
      normalizedWorkspaceId,
      normalizedMonitoringTargetId,
      activeMonitoringTargetStatus,
      activatedAt,
    );

    return {
      id: review.id,
      workspaceId: normalizedWorkspaceId,
      monitoringTargetId: normalizedMonitoringTargetId,
      reviewDecision: review.review_decision,
      activatedByMembershipId: membership.id,
      activatedAt,
      status: activeMonitoringTargetStatus,
    };
  });
}

module.exports = {
  MonitoringTargetServiceError,
  activateMonitoringTarget,
  createMonitoringTarget,
  saveMonitoringTargetReviewDecision,
};
