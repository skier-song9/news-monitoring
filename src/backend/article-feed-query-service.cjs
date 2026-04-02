'use strict';

const { articleAnalysisRiskBands } = require('../db/schema/analysis-alert.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const articleFeedSorts = ['highest_risk', 'lowest_risk', 'newest', 'oldest'];
const articleDashboardLiveRefreshIntervalMs = 4000;
const articleDashboardSortOptions = [
  {
    value: 'highest_risk',
    label: 'Highest risk first',
  },
  {
    value: 'newest',
    label: 'Newest first',
  },
  {
    value: 'lowest_risk',
    label: 'Lowest risk first',
  },
  {
    value: 'oldest',
    label: 'Oldest first',
  },
];

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

  if (DATE_ONLY_PATTERN.test(normalizedValue)) {
    if (fieldName === 'publishedTo') {
      return `${normalizedValue}T23:59:59.999Z`;
    }

    return `${normalizedValue}T00:00:00.000Z`;
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

function normalizeReporter(value) {
  const normalizedValue = normalizeOptionalString(value, 'reporter');

  if (!normalizedValue) {
    return null;
  }

  return normalizedValue.toLowerCase();
}

function normalizeDateInputValue(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return value.slice(0, 10);
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

function listMonitoringTargets(db, workspaceId) {
  return db
    .prepare(`
      SELECT
        id,
        type,
        display_name,
        status
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
    .all(workspaceId)
    .map((row) => ({
      id: row.id,
      type: row.type,
      displayName: row.display_name,
      status: row.status,
    }));
}

function listTopicOptions(db, workspaceId) {
  return db
    .prepare(`
      SELECT
        LOWER(TRIM(topic_label)) AS normalized_topic_label,
        MIN(TRIM(topic_label)) AS topic_label
      FROM article_analysis_topic_label
      WHERE workspace_id = ?
        AND topic_label IS NOT NULL
        AND TRIM(topic_label) <> ''
      GROUP BY LOWER(TRIM(topic_label))
      ORDER BY normalized_topic_label, topic_label
    `)
    .all(workspaceId)
    .map((row) => row.topic_label);
}

function listPublisherOptions(db, workspaceId) {
  return db
    .prepare(`
      SELECT
        LOWER(TRIM(article_content.publisher_name)) AS normalized_publisher_name,
        MIN(TRIM(article_content.publisher_name)) AS publisher_name
      FROM article_content
      INNER JOIN article_analysis
        ON article_analysis.workspace_id = article_content.workspace_id
       AND article_analysis.article_id = article_content.article_id
      WHERE article_content.workspace_id = ?
        AND article_content.publisher_name IS NOT NULL
        AND TRIM(article_content.publisher_name) <> ''
      GROUP BY LOWER(TRIM(article_content.publisher_name))
      ORDER BY normalized_publisher_name, publisher_name
    `)
    .all(workspaceId)
    .map((row) => row.publisher_name);
}

function listReporterOptions(db, workspaceId) {
  return db
    .prepare(`
      SELECT
        LOWER(TRIM(article_content.author_name)) AS normalized_author_name,
        MIN(TRIM(article_content.author_name)) AS author_name
      FROM article_content
      INNER JOIN article_analysis
        ON article_analysis.workspace_id = article_content.workspace_id
       AND article_analysis.article_id = article_content.article_id
      WHERE article_content.workspace_id = ?
        AND article_content.author_name IS NOT NULL
        AND TRIM(article_content.author_name) <> ''
      GROUP BY LOWER(TRIM(article_content.author_name))
      ORDER BY normalized_author_name, author_name
    `)
    .all(workspaceId)
    .map((row) => row.author_name);
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

function normalizeArticleFeedFilters(options) {
  const normalizedFilters = {
    workspaceId: normalizeRequiredString(options.workspaceId, 'workspaceId'),
    userId: normalizeRequiredString(options.userId, 'userId'),
    monitoringTargetId: normalizeOptionalString(options.monitoringTargetId, 'monitoringTargetId'),
    riskBand: normalizeRiskBand(options.riskBand),
    topicLabel: normalizeOptionalString(options.topicLabel, 'topicLabel'),
    publisher: normalizePublisher(options.publisher),
    reporter: normalizeReporter(options.reporter),
    publishedFrom: normalizeTimestamp(options.publishedFrom, 'publishedFrom'),
    publishedTo: normalizeTimestamp(options.publishedTo, 'publishedTo'),
    sort: normalizeSort(options.sort),
  };

  if (
    normalizedFilters.publishedFrom &&
    normalizedFilters.publishedTo &&
    normalizedFilters.publishedFrom > normalizedFilters.publishedTo
  ) {
    throw new ArticleFeedQueryServiceError(
      'INVALID_INPUT',
      'publishedFrom must be earlier than or equal to publishedTo',
    );
  }

  return normalizedFilters;
}

function queryArticleFeedRows(db, filters) {
  const whereClauses = ['article_analysis.workspace_id = ?'];
  const queryParameters = [filters.workspaceId];

  if (filters.monitoringTargetId) {
    whereClauses.push('article_analysis.monitoring_target_id = ?');
    queryParameters.push(filters.monitoringTargetId);
  }

  if (filters.riskBand) {
    whereClauses.push('article_analysis.risk_band = ?');
    queryParameters.push(filters.riskBand);
  }

  if (filters.topicLabel) {
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM article_analysis_topic_label AS topic_filter
        WHERE topic_filter.workspace_id = article_analysis.workspace_id
          AND topic_filter.article_analysis_id = article_analysis.id
          AND topic_filter.topic_label = ?
      )
    `);
    queryParameters.push(filters.topicLabel);
  }

  if (filters.publisher) {
    whereClauses.push('LOWER(TRIM(article_content.publisher_name)) = ?');
    queryParameters.push(filters.publisher);
  }

  if (filters.reporter) {
    whereClauses.push('LOWER(TRIM(article_content.author_name)) = ?');
    queryParameters.push(filters.reporter);
  }

  if (filters.publishedFrom) {
    whereClauses.push('article_content.published_at IS NOT NULL');
    whereClauses.push('article_content.published_at >= ?');
    queryParameters.push(filters.publishedFrom);
  }

  if (filters.publishedTo) {
    whereClauses.push('article_content.published_at IS NOT NULL');
    whereClauses.push('article_content.published_at <= ?');
    queryParameters.push(filters.publishedTo);
  }

  const rows = db
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
      ORDER BY ${getSortOrderBy(filters.sort)}
    `)
    .all(...queryParameters);

  return rows.map(toArticleFeedRecord);
}

function listArticleFeed(options) {
  const normalizedFilters = normalizeArticleFeedFilters(options);

  requireActiveWorkspaceMember(
    options.db,
    normalizedFilters.workspaceId,
    normalizedFilters.userId,
  );

  return queryArticleFeedRows(options.db, normalizedFilters);
}

function getArticleDashboardPage(options) {
  const normalizedFilters = normalizeArticleFeedFilters(options);
  const workspace = getWorkspace(options.db, normalizedFilters.workspaceId);

  if (!workspace) {
    throw new ArticleFeedQueryServiceError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
  }

  const membership = requireActiveWorkspaceMember(
    options.db,
    normalizedFilters.workspaceId,
    normalizedFilters.userId,
  );

  return {
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
    },
    viewer: {
      userId: normalizedFilters.userId,
      membershipId: membership.id,
      role: membership.role,
    },
    filters: {
      values: {
        monitoringTargetId: normalizedFilters.monitoringTargetId ?? '',
        riskBand: normalizedFilters.riskBand ?? '',
        topicLabel: normalizedFilters.topicLabel ?? '',
        publisher: options.publisher == null ? '' : String(options.publisher).trim(),
        reporter: options.reporter == null ? '' : String(options.reporter).trim(),
        publishedFrom: normalizeDateInputValue(options.publishedFrom),
        publishedTo: normalizeDateInputValue(options.publishedTo),
        sort: normalizedFilters.sort,
      },
      options: {
        monitoringTargets: listMonitoringTargets(options.db, normalizedFilters.workspaceId),
        riskBands: articleAnalysisRiskBands.map((riskBand) => ({
          value: riskBand,
          label: `${riskBand[0].toUpperCase()}${riskBand.slice(1)} risk`,
        })),
        topics: listTopicOptions(options.db, normalizedFilters.workspaceId),
        publishers: listPublisherOptions(options.db, normalizedFilters.workspaceId),
        reporters: listReporterOptions(options.db, normalizedFilters.workspaceId),
        sorts: articleDashboardSortOptions.map((sortOption) => ({ ...sortOption })),
      },
    },
    articles: queryArticleFeedRows(options.db, normalizedFilters),
    liveRefresh: {
      intervalMs: articleDashboardLiveRefreshIntervalMs,
    },
  };
}

module.exports = {
  ArticleFeedQueryServiceError,
  articleDashboardLiveRefreshIntervalMs,
  articleFeedSorts,
  getArticleDashboardPage,
  listArticleFeed,
};
