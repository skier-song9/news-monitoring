'use strict';

const { randomUUID } = require('node:crypto');

const {
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetTypes,
} = require('../db/schema/monitoring-target.cjs');
const { defaultTargetKeywordIsActive } = require('../db/schema/target-keyword.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const SEED_KEYWORD_SOURCE_TYPE = 'seed';

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
        SEED_KEYWORD_SOURCE_TYPE,
        defaultTargetKeywordIsActive,
        displayOrder,
        createdAt,
        createdAt,
      );

      return {
        id: keywordId,
        keyword,
        sourceType: SEED_KEYWORD_SOURCE_TYPE,
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

module.exports = {
  MonitoringTargetServiceError,
  createMonitoringTarget,
};
