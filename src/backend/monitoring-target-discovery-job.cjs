'use strict';

const { randomUUID } = require('node:crypto');

const {
  defaultMonitoringTargetStatus,
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
} = require('../db/schema/monitoring-target.cjs');
const {
  defaultTargetKeywordIsActive,
  expandedTargetKeywordSourceType,
  seedTargetKeywordSourceType,
} = require('../db/schema/target-keyword.cjs');

const DISCOVERABLE_MONITORING_TARGET_STATUSES = [
  defaultMonitoringTargetStatus,
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
];

class MonitoringTargetDiscoveryJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MonitoringTargetDiscoveryJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new MonitoringTargetDiscoveryJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new MonitoringTargetDiscoveryJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new MonitoringTargetDiscoveryJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeStringArray(value, fieldName) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new MonitoringTargetDiscoveryJobError('INVALID_INPUT', `${fieldName} must be an array`);
  }

  const normalizedValues = [];
  const seenValues = new Set();

  for (const [index, item] of value.entries()) {
    const normalizedValue = normalizeRequiredString(item, `${fieldName}[${index}]`);
    const dedupeKey = normalizedValue.toLowerCase();

    if (seenValues.has(dedupeKey)) {
      continue;
    }

    seenValues.add(dedupeKey);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function normalizeSearchResult(result, fieldName) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new MonitoringTargetDiscoveryJobError('INVALID_INPUT', `${fieldName} must be an object`);
  }

  return {
    title: normalizeRequiredString(result.title, `${fieldName}.title`),
    url: normalizeRequiredString(result.url, `${fieldName}.url`),
    snippet: normalizeOptionalString(result.snippet, `${fieldName}.snippet`),
    source: normalizeOptionalString(result.source, `${fieldName}.source`),
  };
}

function normalizeSearchResults(searchResults, keyword) {
  if (!Array.isArray(searchResults)) {
    throw new MonitoringTargetDiscoveryJobError(
      'INVALID_INPUT',
      `searchWeb must return an array for keyword "${keyword}"`,
    );
  }

  return searchResults.map((result, index) =>
    normalizeSearchResult(result, `searchResults[${keyword}][${index}]`),
  );
}

function normalizeGeneratedProfile(profile, seedKeywords) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new MonitoringTargetDiscoveryJobError(
      'INVALID_INPUT',
      'generateTargetProfile must return an object',
    );
  }

  const seedKeywordKeys = new Set(seedKeywords.map((keyword) => keyword.toLowerCase()));
  const expandedKeywords = normalizeStringArray(profile.expandedKeywords, 'expandedKeywords').filter(
    (keyword) => !seedKeywordKeys.has(keyword.toLowerCase()),
  );

  return {
    summary: normalizeRequiredString(profile.summary, 'summary'),
    relatedEntities: normalizeStringArray(profile.relatedEntities, 'relatedEntities'),
    aliases: normalizeStringArray(profile.aliases, 'aliases'),
    expandedKeywords,
    modelVersion: normalizeRequiredString(profile.modelVersion, 'modelVersion'),
  };
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

function getMonitoringTarget(db, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id, workspace_id, type, display_name, note, status, default_risk_threshold
      FROM monitoring_target
      WHERE id = ?
    `)
    .get(monitoringTargetId);
}

function getMonitoringTargetProfile(db, workspaceId, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id
      FROM monitoring_target_profile
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get(workspaceId, monitoringTargetId);
}

function listSeedKeywords(db, monitoringTargetId) {
  return db
    .prepare(`
      SELECT id, keyword
      FROM target_keyword
      WHERE monitoring_target_id = ?
        AND source_type = ?
        AND is_active = 1
      ORDER BY display_order, created_at, id
    `)
    .all(monitoringTargetId, seedTargetKeywordSourceType);
}

function updateMonitoringTargetStatus(db, monitoringTargetId, status, updatedAt) {
  db.prepare(`
    UPDATE monitoring_target
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(status, updatedAt, monitoringTargetId);
}

async function runMonitoringTargetDiscoveryJob({
  db,
  monitoringTargetId,
  searchWeb,
  generateTargetProfile,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const normalizedMonitoringTargetId = normalizeRequiredString(
    monitoringTargetId,
    'monitoringTargetId',
  );

  if (typeof searchWeb !== 'function') {
    throw new MonitoringTargetDiscoveryJobError(
      'INVALID_INPUT',
      'searchWeb must be a function',
    );
  }

  if (typeof generateTargetProfile !== 'function') {
    throw new MonitoringTargetDiscoveryJobError(
      'INVALID_INPUT',
      'generateTargetProfile must be a function',
    );
  }

  const monitoringTarget = getMonitoringTarget(db, normalizedMonitoringTargetId);

  if (!monitoringTarget) {
    throw new MonitoringTargetDiscoveryJobError(
      'MONITORING_TARGET_NOT_FOUND',
      'Monitoring target does not exist',
    );
  }

  if (!DISCOVERABLE_MONITORING_TARGET_STATUSES.includes(monitoringTarget.status)) {
    throw new MonitoringTargetDiscoveryJobError(
      'MONITORING_TARGET_STATUS_INVALID',
      `Monitoring target status ${monitoringTarget.status} cannot run discovery`,
    );
  }

  const seedKeywordRows = listSeedKeywords(db, normalizedMonitoringTargetId);

  if (seedKeywordRows.length === 0) {
    throw new MonitoringTargetDiscoveryJobError(
      'MONITORING_TARGET_SEED_KEYWORD_REQUIRED',
      'At least one active seed keyword is required for discovery',
    );
  }

  const normalizedMonitoringTarget = {
    id: monitoringTarget.id,
    workspaceId: monitoringTarget.workspace_id,
    type: monitoringTarget.type,
    displayName: monitoringTarget.display_name,
    note: monitoringTarget.note,
    status: monitoringTarget.status,
    defaultRiskThreshold: monitoringTarget.default_risk_threshold,
  };
  const seedKeywords = seedKeywordRows.map((seedKeyword) => ({
    id: seedKeyword.id,
    keyword: seedKeyword.keyword,
  }));

  updateMonitoringTargetStatus(
    db,
    normalizedMonitoringTargetId,
    monitoringTargetProfileInProgressStatus,
    now(),
  );

  const searchResults = [];

  for (const seedKeyword of seedKeywords) {
    const results = await searchWeb({
      monitoringTarget: normalizedMonitoringTarget,
      keyword: seedKeyword.keyword,
      seedKeyword,
    });

    searchResults.push({
      keyword: seedKeyword.keyword,
      results: normalizeSearchResults(results, seedKeyword.keyword),
    });
  }

  const generatedProfile = normalizeGeneratedProfile(
    await generateTargetProfile({
      monitoringTarget: normalizedMonitoringTarget,
      seedKeywords,
      searchResults,
    }),
    seedKeywords.map((seedKeyword) => seedKeyword.keyword),
  );

  return runInTransaction(db, () => {
    const persistedAt = now();
    const existingProfile = getMonitoringTargetProfile(
      db,
      normalizedMonitoringTarget.workspaceId,
      normalizedMonitoringTarget.id,
    );
    const profileId = existingProfile ? existingProfile.id : createId();

    db.prepare(`
      INSERT INTO monitoring_target_profile (
        id,
        workspace_id,
        monitoring_target_id,
        summary,
        related_entities_json,
        aliases_json,
        search_results_json,
        model_version,
        generated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, monitoring_target_id) DO UPDATE SET
        summary = excluded.summary,
        related_entities_json = excluded.related_entities_json,
        aliases_json = excluded.aliases_json,
        search_results_json = excluded.search_results_json,
        model_version = excluded.model_version,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
    `).run(
      profileId,
      normalizedMonitoringTarget.workspaceId,
      normalizedMonitoringTarget.id,
      generatedProfile.summary,
      JSON.stringify(generatedProfile.relatedEntities),
      JSON.stringify(generatedProfile.aliases),
      JSON.stringify(searchResults),
      generatedProfile.modelVersion,
      persistedAt,
      persistedAt,
      persistedAt,
    );

    db.prepare(`
      DELETE FROM target_keyword
      WHERE monitoring_target_id = ? AND source_type = ?
    `).run(normalizedMonitoringTarget.id, expandedTargetKeywordSourceType);

    const expandedKeywords = generatedProfile.expandedKeywords.map((keyword, displayOrder) => {
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
        normalizedMonitoringTarget.id,
        keyword,
        expandedTargetKeywordSourceType,
        defaultTargetKeywordIsActive,
        displayOrder,
        persistedAt,
        persistedAt,
      );

      return {
        id: keywordId,
        keyword,
        sourceType: expandedTargetKeywordSourceType,
        isActive: defaultTargetKeywordIsActive,
        displayOrder,
      };
    });

    updateMonitoringTargetStatus(
      db,
      normalizedMonitoringTarget.id,
      monitoringTargetReadyForReviewStatus,
      persistedAt,
    );

    return {
      id: profileId,
      workspaceId: normalizedMonitoringTarget.workspaceId,
      monitoringTargetId: normalizedMonitoringTarget.id,
      status: monitoringTargetReadyForReviewStatus,
      summary: generatedProfile.summary,
      relatedEntities: generatedProfile.relatedEntities,
      aliases: generatedProfile.aliases,
      searchResults,
      expandedKeywords,
      modelVersion: generatedProfile.modelVersion,
      generatedAt: persistedAt,
    };
  });
}

module.exports = {
  MonitoringTargetDiscoveryJobError,
  runMonitoringTargetDiscoveryJob,
};
