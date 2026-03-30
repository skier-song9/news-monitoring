'use strict';

const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../db/schema/analysis-alert.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';

class ArticleDetailQueryServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleDetailQueryServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleDetailQueryServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleDetailQueryServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
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

function requireActiveWorkspaceMember(db, workspaceId, userId) {
  const membership = getMembership(db, workspaceId, userId);

  if (!membership || membership.status !== ACTIVE_MEMBERSHIP_STATUS) {
    throw new ArticleDetailQueryServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can query article details',
    );
  }

  return membership;
}

function parseTopicLabels(value) {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getArticleDetailRow(db, workspaceId, articleAnalysisId) {
  return db
    .prepare(`
      SELECT
        article_analysis.id AS article_analysis_id,
        article_analysis.article_id AS article_id,
        article_analysis.monitoring_target_id AS monitoring_target_id,
        monitoring_target.display_name AS target_name,
        article_content.title AS title,
        article_analysis.relevance_score AS relevance_score,
        article_analysis.topic_labels AS topic_labels,
        article_analysis.summary AS summary,
        article_analysis.risk_score AS risk_score,
        article_analysis.risk_band AS risk_band,
        article_analysis.rationale AS rationale,
        article_analysis.model_version AS model_version,
        article_analysis.relevance_scored_at AS relevance_scored_at,
        article_analysis.topics_classified_at AS topics_classified_at,
        article_analysis.summary_generated_at AS summary_generated_at,
        article_analysis.risk_scored_at AS risk_scored_at,
        article_analysis.created_at AS analysis_created_at,
        article_analysis.updated_at AS analysis_updated_at,
        article.source_url AS source_url,
        article.canonical_url AS canonical_url,
        article.ingestion_status AS ingestion_status,
        article_content.publisher_name AS publisher_name,
        article_content.author_name AS author_name,
        article_content.published_at AS published_at,
        article_content.fetched_at AS fetched_at
      FROM article_analysis
      INNER JOIN monitoring_target
        ON monitoring_target.workspace_id = article_analysis.workspace_id
       AND monitoring_target.id = article_analysis.monitoring_target_id
      INNER JOIN article
        ON article.workspace_id = article_analysis.workspace_id
       AND article.id = article_analysis.article_id
      INNER JOIN article_content
        ON article_content.workspace_id = article_analysis.workspace_id
       AND article_content.article_id = article_analysis.article_id
      WHERE article_analysis.workspace_id = ?
        AND article_analysis.id = ?
    `)
    .get(workspaceId, articleAnalysisId);
}

function listArticleAnalysisRelevanceSignals(db, workspaceId, articleAnalysisId) {
  return db
    .prepare(`
      SELECT signal_type, signal_value
      FROM article_analysis_relevance_signal
      WHERE workspace_id = ?
        AND article_analysis_id = ?
      ORDER BY
        CASE signal_type
          WHEN ? THEN 0
          WHEN ? THEN 1
          ELSE 2
        END,
        LOWER(signal_value),
        signal_value
    `)
    .all(
      workspaceId,
      articleAnalysisId,
      keywordArticleAnalysisRelevanceSignalType,
      entityArticleAnalysisRelevanceSignalType,
    );
}

function listPortalUrls(db, workspaceId, monitoringTargetId, articleId) {
  const rows = db
    .prepare(`
      SELECT DISTINCT portal_url
      FROM article_candidate
      WHERE workspace_id = ?
        AND monitoring_target_id = ?
        AND article_id = ?
        AND portal_url IS NOT NULL
      ORDER BY LOWER(portal_url), portal_url
    `)
    .all(workspaceId, monitoringTargetId, articleId);

  return rows
    .map((row) => row.portal_url)
    .filter((portalUrl) => typeof portalUrl === 'string' && portalUrl.trim().length > 0);
}

function groupRelevanceSignals(rows) {
  const matchedKeywords = [];
  const entitySignals = [];

  for (const row of rows) {
    if (row.signal_type === keywordArticleAnalysisRelevanceSignalType) {
      matchedKeywords.push(row.signal_value);
      continue;
    }

    if (row.signal_type === entityArticleAnalysisRelevanceSignalType) {
      entitySignals.push(row.signal_value);
    }
  }

  return {
    matchedKeywords,
    entitySignals,
  };
}

function toArticleDetailRecord(row, relevanceSignals, portalUrls) {
  return {
    articleAnalysisId: row.article_analysis_id,
    articleId: row.article_id,
    monitoringTargetId: row.monitoring_target_id,
    targetName: row.target_name,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    relevanceScore: row.relevance_score,
    riskScore: row.risk_score,
    riskBand: row.risk_band,
    topicLabels: parseTopicLabels(row.topic_labels),
    matchedKeywords: relevanceSignals.matchedKeywords,
    entitySignals: relevanceSignals.entitySignals,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    portalUrls,
    ingestionStatus: row.ingestion_status,
    publisherName: row.publisher_name,
    authorName: row.author_name,
    ingestionTimestamps: {
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
    },
    analysisTimestamps: {
      createdAt: row.analysis_created_at,
      updatedAt: row.analysis_updated_at,
      relevanceScoredAt: row.relevance_scored_at,
      topicsClassifiedAt: row.topics_classified_at,
      summaryGeneratedAt: row.summary_generated_at,
      riskScoredAt: row.risk_scored_at,
    },
    modelVersion: row.model_version,
  };
}

function getArticleDetail(options) {
  const normalizedWorkspaceId = normalizeRequiredString(options.workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(options.userId, 'userId');
  const normalizedArticleAnalysisId = normalizeRequiredString(
    options.articleAnalysisId,
    'articleAnalysisId',
  );

  requireActiveWorkspaceMember(options.db, normalizedWorkspaceId, normalizedUserId);

  const row = getArticleDetailRow(options.db, normalizedWorkspaceId, normalizedArticleAnalysisId);

  if (!row) {
    throw new ArticleDetailQueryServiceError(
      'ARTICLE_DETAIL_NOT_FOUND',
      'Article detail was not found for the requested workspace',
    );
  }

  const relevanceSignals = groupRelevanceSignals(
    listArticleAnalysisRelevanceSignals(
      options.db,
      normalizedWorkspaceId,
      normalizedArticleAnalysisId,
    ),
  );
  const portalUrls = listPortalUrls(
    options.db,
    normalizedWorkspaceId,
    row.monitoring_target_id,
    row.article_id,
  );

  return toArticleDetailRecord(row, relevanceSignals, portalUrls);
}

module.exports = {
  ArticleDetailQueryServiceError,
  getArticleDetail,
};
