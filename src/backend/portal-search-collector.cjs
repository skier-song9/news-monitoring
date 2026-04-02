'use strict';

const { randomUUID } = require('node:crypto');

const { getMonitoringTargetCollectorInput } = require('./monitoring-target-service.cjs');
const {
  articleCandidatePortalNames,
  defaultArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
  processingArticleCandidateIngestionStatus,
} = require('../db/schema/article-ingestion.cjs');
const { activeMonitoringTargetStatus } = require('../db/schema/monitoring-target.cjs');

const PORTAL_SEARCH_CONFIGS = [
  {
    portalName: articleCandidatePortalNames[0],
    searchFunctionName: 'searchNaverNews',
  },
  {
    portalName: articleCandidatePortalNames[1],
    searchFunctionName: 'searchNateNews',
  },
  {
    portalName: articleCandidatePortalNames[2],
    searchFunctionName: 'searchGoogleNews',
  },
];

class PortalSearchCollectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PortalSearchCollectorError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new PortalSearchCollectorError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new PortalSearchCollectorError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new PortalSearchCollectorError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizePortalSearchFunction(searchFunction, searchFunctionName) {
  if (typeof searchFunction !== 'function') {
    throw new PortalSearchCollectorError(
      'INVALID_INPUT',
      `${searchFunctionName} must be a function`,
    );
  }

  return searchFunction;
}

function normalizePortalSearchResult(result, fieldName) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new PortalSearchCollectorError('INVALID_INPUT', `${fieldName} must be an object`);
  }

  return {
    portalUrl: normalizeRequiredString(result.portalUrl, `${fieldName}.portalUrl`),
    sourceUrl: normalizeOptionalString(result.sourceUrl, `${fieldName}.sourceUrl`),
    title: normalizeRequiredString(result.title, `${fieldName}.title`),
    snippet: normalizeOptionalString(result.snippet, `${fieldName}.snippet`),
    publishedAt: normalizeOptionalString(result.publishedAt, `${fieldName}.publishedAt`),
  };
}

function normalizePortalSearchResults(portalName, results) {
  if (!Array.isArray(results)) {
    throw new PortalSearchCollectorError(
      'INVALID_INPUT',
      `${portalName} search must return an array`,
    );
  }

  const normalizedResults = [];
  const seenPortalUrls = new Set();

  for (const [index, result] of results.entries()) {
    const normalizedResult = normalizePortalSearchResult(result, `${portalName}Results[${index}]`);
    const portalUrlKey = normalizedResult.portalUrl.toLowerCase();

    if (seenPortalUrls.has(portalUrlKey)) {
      continue;
    }

    seenPortalUrls.add(portalUrlKey);
    normalizedResults.push(normalizedResult);
  }

  return normalizedResults;
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

function listActiveMonitoringTargets(db) {
  return db
    .prepare(`
      SELECT id, workspace_id, type, display_name, note, status, default_risk_threshold
      FROM monitoring_target
      WHERE status = ?
      ORDER BY workspace_id, created_at, id
    `)
    .all(activeMonitoringTargetStatus);
}

function getArticleCandidate(db, monitoringTargetId, portalUrl) {
  return db
    .prepare(`
      SELECT id, article_id, ingestion_status, ingestion_error
      FROM article_candidate
      WHERE monitoring_target_id = ? AND portal_url = ?
    `)
    .get(monitoringTargetId, portalUrl);
}

function normalizeMonitoringTargetRow(target) {
  return {
    id: target.id,
    workspaceId: target.workspace_id,
    type: target.type,
    displayName: target.display_name,
    note: target.note,
    status: target.status,
    defaultRiskThreshold: target.default_risk_threshold,
  };
}

function normalizeCollectorInput(collectorInput) {
  return {
    workspaceId: collectorInput.workspaceId,
    monitoringTargetId: collectorInput.monitoringTargetId,
    seedKeywords: collectorInput.seedKeywords.map((keyword) => ({ ...keyword })),
    expandedKeywords: collectorInput.expandedKeywords.map((keyword) => ({ ...keyword })),
    excludedKeywords: collectorInput.excludedKeywords.map((keyword) => ({ ...keyword })),
  };
}

function getRefreshedCandidateState(existingCandidate) {
  if (
    existingCandidate &&
    (existingCandidate.article_id ||
      existingCandidate.ingestion_status === processingArticleCandidateIngestionStatus ||
      existingCandidate.ingestion_status === linkedArticleCandidateIngestionStatus)
  ) {
    return {
      articleId: existingCandidate.article_id,
      ingestionStatus: existingCandidate.ingestion_status,
      ingestionError: existingCandidate.ingestion_error,
    };
  }

  return {
    articleId: existingCandidate ? existingCandidate.article_id : null,
    ingestionStatus: defaultArticleCandidateIngestionStatus,
    ingestionError: null,
  };
}

function persistPortalSearchResults({
  db,
  workspaceId,
  monitoringTargetId,
  portalName,
  results,
  now,
  createId,
}) {
  return runInTransaction(db, () => {
    const persistedAt = now();

    return results.map((result) => {
      const existingCandidate = getArticleCandidate(db, monitoringTargetId, result.portalUrl);
      const articleCandidateId = existingCandidate ? existingCandidate.id : createId();
      const refreshedCandidateState = getRefreshedCandidateState(existingCandidate);

      if (existingCandidate) {
        db.prepare(`
          UPDATE article_candidate
          SET source_url = ?,
              article_id = ?,
              ingestion_status = ?,
              ingestion_error = ?,
              updated_at = ?
          WHERE monitoring_target_id = ? AND id = ?
        `).run(
          result.sourceUrl,
          refreshedCandidateState.articleId,
          refreshedCandidateState.ingestionStatus,
          refreshedCandidateState.ingestionError,
          persistedAt,
          monitoringTargetId,
          articleCandidateId,
        );
      } else {
        db.prepare(`
          INSERT INTO article_candidate (
            id,
            workspace_id,
            monitoring_target_id,
            article_id,
            portal_url,
            source_url,
            ingestion_status,
            ingestion_error,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          articleCandidateId,
          workspaceId,
          monitoringTargetId,
          refreshedCandidateState.articleId,
          result.portalUrl,
          result.sourceUrl,
          refreshedCandidateState.ingestionStatus,
          refreshedCandidateState.ingestionError,
          persistedAt,
          persistedAt,
        );
      }

      db.prepare(`
        INSERT INTO article_candidate_portal_metadata (
          article_candidate_id,
          workspace_id,
          portal_name,
          portal_title,
          portal_snippet,
          portal_published_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (article_candidate_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          portal_name = excluded.portal_name,
          portal_title = excluded.portal_title,
          portal_snippet = excluded.portal_snippet,
          portal_published_at = excluded.portal_published_at,
          updated_at = excluded.updated_at
      `).run(
        articleCandidateId,
        workspaceId,
        portalName,
        result.title,
        result.snippet,
        result.publishedAt,
        persistedAt,
        persistedAt,
      );

      return {
        id: articleCandidateId,
        workspaceId,
        monitoringTargetId,
        portalName,
        portalUrl: result.portalUrl,
        sourceUrl: result.sourceUrl,
        title: result.title,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        ingestionStatus: refreshedCandidateState.ingestionStatus,
      };
    });
  });
}

async function runPortalSearchCollector({
  db,
  searchNaverNews,
  searchNateNews,
  searchGoogleNews,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const searchFunctionsByPortal = new Map(
    PORTAL_SEARCH_CONFIGS.map(({ portalName, searchFunctionName }) => [
      portalName,
      normalizePortalSearchFunction(
        {
          searchNaverNews,
          searchNateNews,
          searchGoogleNews,
        }[searchFunctionName],
        searchFunctionName,
      ),
    ]),
  );

  const processedTargets = [];

  for (const target of listActiveMonitoringTargets(db)) {
    const monitoringTarget = normalizeMonitoringTargetRow(target);
    const collectorInput = normalizeCollectorInput(
      getMonitoringTargetCollectorInput({
        db,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
      }),
    );
    const portalSearchResults = await Promise.all(
      PORTAL_SEARCH_CONFIGS.map(async ({ portalName }) => {
        const searchFunction = searchFunctionsByPortal.get(portalName);
        const results = normalizePortalSearchResults(
          portalName,
          await searchFunction({
            monitoringTarget,
            collectorInput,
          }),
        );
        return { portalName, results };
      }),
    );

    const portals = portalSearchResults.map(({ portalName, results }) => {
      const candidates = persistPortalSearchResults({
        db,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        portalName,
        results,
        now,
        createId,
      });
      return { portalName, candidates };
    });

    processedTargets.push({
      workspaceId: monitoringTarget.workspaceId,
      monitoringTargetId: monitoringTarget.id,
      portals,
    });
  }

  return {
    processedTargets,
    totalCandidates: processedTargets.reduce(
      (total, target) =>
        total + target.portals.reduce((portalTotal, portal) => portalTotal + portal.candidates.length, 0),
      0,
    ),
  };
}

module.exports = {
  PortalSearchCollectorError,
  runPortalSearchCollector,
};
