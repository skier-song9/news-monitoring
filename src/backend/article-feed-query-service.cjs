'use strict';

const { articleAnalysisRiskBands } = require('../db/schema/analysis-alert.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const articleFeedSorts = ['highest_risk', 'lowest_risk', 'newest', 'oldest'];

class ArticleFeedQueryServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleFeedQueryServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleFeedQueryServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleFeedQueryServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ArticleFeedQueryServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeRiskBand(value) {
  if (value == null) {
    return null;
  }

  const normalizedValue = normalizeRequiredString(value, 'riskBand').toLowerCase();

  if (!articleAnalysisRiskBands.includes(normalizedValue)) {
    throw new ArticleFeedQueryServiceError(
      'INVALID_INPUT',
      `riskBand must be one of: ${articleAnalysisRiskBands.join(', ')}`,
    );
  }

  return normalizedValue;
}

function normalizeSort(value) {
  if (value == null) {
    return articleFeedSorts[0];
  }

  const normalizedValue = normalizeRequiredString(value, 'sort').toLowerCase();

  if (!articleFeedSorts.includes(normalizedValue)) {
    throw new ArticleFeedQueryServiceError(
      'INVALID_INPUT',
      `sort must be one of: ${articleFeedSorts.join(', ')}`,
    );
  }

  return normalizedValue;
}

function normalizeTimestamp(value, fieldName) {
  const normalizedValue = normalizeOptionalString(value, fieldName);

  if (!normalizedValue) {
    return null;
  }

  const timestamp = Date.parse(normalizedValue);

  if (Number.isNaN(timestamp)) {
    throw new ArticleFeedQueryServiceError(
      'INVALID_INPUT',
      `${fieldName} must be a valid timestamp`,
    );
  }

  return new Date(timestamp).toISOString();
}

function normalizePublisher(value) {
  const normalizedValue = normalizeOptionalString(value, 'publisher');

  if (!normalizedValue) {
    return null;
  }

  return normalizedValue.toLowerCase();
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
    throw new ArticleFeedQueryServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can query the article feed',
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

function toArticleFeedRecord(row) {
  return {
    articleAnalysisId: row.article_analysis_id,
    articleId: row.article_id,
    monitoringTargetId: row.monitoring_target_id,
    targetName: row.target_name,
    title: row.title,
    riskScore: row.risk_score,
    riskBand: row.risk_band,
    topicLabels: parseTopicLabels(row.topic_labels),
    publisherName: row.publisher_name,
    authorName: row.author_name,
    publishedAt: row.published_at,
  };
}

function getSortOrderBy(sort) {
  switch (sort) {
    case 'highest_risk':
      return `
        article_analysis.risk_score IS NULL,
        article_analysis.risk_score DESC,
        article_content.published_at IS NULL,
        article_content.published_at DESC,
        article_analysis.updated_at DESC,
        article_analysis.id DESC
      `;
    case 'lowest_risk':
      return `
        article_analysis.risk_score IS NULL,
        article_analysis.risk_score ASC,
        article_content.published_at IS NULL,
        article_content.published_at DESC,
        article_analysis.updated_at DESC,
        article_analysis.id DESC
      `;
    case 'newest':
      return `
        article_content.published_at IS NULL,
        article_content.published_at DESC,
        article_analysis.risk_score IS NULL,
        article_analysis.risk_score DESC,
        article_analysis.updated_at DESC,
        article_analysis.id DESC
      `;
    case 'oldest':
      return `
        article_content.published_at IS NULL,
        article_content.published_at ASC,
        article_analysis.risk_score IS NULL,
        article_analysis.risk_score DESC,
        article_analysis.updated_at DESC,
        article_analysis.id DESC
      `;
    default:
      throw new ArticleFeedQueryServiceError('INVALID_INPUT', 'sort must be a supported value');
  }
}

function listArticleFeed(options) {
  const normalizedWorkspaceId = normalizeRequiredString(options.workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(options.userId, 'userId');
  const normalizedMonitoringTargetId = normalizeOptionalString(
    options.monitoringTargetId,
    'monitoringTargetId',
  );
  const normalizedRiskBand = normalizeRiskBand(options.riskBand);
  const normalizedTopicLabel = normalizeOptionalString(options.topicLabel, 'topicLabel');
  const normalizedPublisher = normalizePublisher(options.publisher);
  const publishedFrom = normalizeTimestamp(options.publishedFrom, 'publishedFrom');
  const publishedTo = normalizeTimestamp(options.publishedTo, 'publishedTo');
  const normalizedSort = normalizeSort(options.sort);

  if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
    throw new ArticleFeedQueryServiceError(
      'INVALID_INPUT',
      'publishedFrom must be earlier than or equal to publishedTo',
    );
  }

  requireActiveWorkspaceMember(options.db, normalizedWorkspaceId, normalizedUserId);

  const whereClauses = ['article_analysis.workspace_id = ?'];
  const queryParameters = [normalizedWorkspaceId];

  if (normalizedMonitoringTargetId) {
    whereClauses.push('article_analysis.monitoring_target_id = ?');
    queryParameters.push(normalizedMonitoringTargetId);
  }

  if (normalizedRiskBand) {
    whereClauses.push('article_analysis.risk_band = ?');
    queryParameters.push(normalizedRiskBand);
  }

  if (normalizedTopicLabel) {
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM article_analysis_topic_label AS topic_filter
        WHERE topic_filter.workspace_id = article_analysis.workspace_id
          AND topic_filter.article_analysis_id = article_analysis.id
          AND topic_filter.topic_label = ?
      )
    `);
    queryParameters.push(normalizedTopicLabel);
  }

  if (normalizedPublisher) {
    whereClauses.push('LOWER(TRIM(article_content.publisher_name)) = ?');
    queryParameters.push(normalizedPublisher);
  }

  if (publishedFrom) {
    whereClauses.push('article_content.published_at IS NOT NULL');
    whereClauses.push('article_content.published_at >= ?');
    queryParameters.push(publishedFrom);
  }

  if (publishedTo) {
    whereClauses.push('article_content.published_at IS NOT NULL');
    whereClauses.push('article_content.published_at <= ?');
    queryParameters.push(publishedTo);
  }

  const rows = options.db
    .prepare(`
      SELECT
        article_analysis.id AS article_analysis_id,
        article_analysis.article_id AS article_id,
        article_analysis.monitoring_target_id AS monitoring_target_id,
        monitoring_target.display_name AS target_name,
        article_content.title AS title,
        article_analysis.risk_score AS risk_score,
        article_analysis.risk_band AS risk_band,
        article_analysis.topic_labels AS topic_labels,
        article_content.publisher_name AS publisher_name,
        article_content.author_name AS author_name,
        article_content.published_at AS published_at
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
      WHERE ${whereClauses.join('\n        AND ')}
      ORDER BY ${getSortOrderBy(normalizedSort)}
    `)
    .all(...queryParameters);

  return rows.map(toArticleFeedRecord);
}

module.exports = {
  ArticleFeedQueryServiceError,
  articleFeedSorts,
  listArticleFeed,
};
