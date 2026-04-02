'use strict';

const { highArticleAnalysisRiskBand } = require('../db/schema/analysis-alert.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

class ArticleAnalyticsQueryServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleAnalyticsQueryServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleAnalyticsQueryServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleAnalyticsQueryServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ArticleAnalyticsQueryServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
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
    throw new ArticleAnalyticsQueryServiceError(
      'INVALID_INPUT',
      `${fieldName} must be a valid timestamp`,
    );
  }

  return new Date(timestamp).toISOString();
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
    throw new ArticleAnalyticsQueryServiceError(
      'WORKSPACE_MEMBER_FORBIDDEN',
      'Only active workspace members can query article analytics',
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

function buildHighRiskWhereClause(filters) {
  const whereClauses = [
    'article_analysis.workspace_id = ?',
    'article_analysis.risk_band = ?',
    'article_content.published_at IS NOT NULL',
  ];
  const queryParameters = [filters.workspaceId, highArticleAnalysisRiskBand];

  if (filters.monitoringTargetId) {
    whereClauses.push('article_analysis.monitoring_target_id = ?');
    queryParameters.push(filters.monitoringTargetId);
  }

  if (filters.publishedFrom) {
    whereClauses.push('article_content.published_at >= ?');
    queryParameters.push(filters.publishedFrom);
  }

  if (filters.publishedTo) {
    whereClauses.push('article_content.published_at <= ?');
    queryParameters.push(filters.publishedTo);
  }

  return {
    whereClauses,
    queryParameters,
  };
}

function listTopicRows(db, filters) {
  const { whereClauses, queryParameters } = buildHighRiskWhereClause(filters);
  whereClauses.push('topic.topic_label IS NOT NULL');
  whereClauses.push("TRIM(topic.topic_label) <> ''");

  return db
    .prepare(`
      SELECT
        topic.topic_label AS label,
        article_analysis.id AS article_analysis_id,
        article_analysis.article_id AS article_id
      FROM article_analysis
      INNER JOIN article_content
        ON article_content.workspace_id = article_analysis.workspace_id
       AND article_content.article_id = article_analysis.article_id
      INNER JOIN article_analysis_topic_label AS topic
        ON topic.workspace_id = article_analysis.workspace_id
       AND topic.article_analysis_id = article_analysis.id
      WHERE ${whereClauses.join('\n        AND ')}
      ORDER BY
        article_analysis.risk_score DESC,
        article_content.published_at DESC,
        article_analysis.id ASC
    `)
    .all(...queryParameters);
}

function listPublisherRows(db, filters) {
  const { whereClauses, queryParameters } = buildHighRiskWhereClause(filters);
  whereClauses.push('article_content.publisher_name IS NOT NULL');
  whereClauses.push("TRIM(article_content.publisher_name) <> ''");

  return db
    .prepare(`
      SELECT
        article_content.publisher_name AS label,
        article_analysis.id AS article_analysis_id,
        article_analysis.article_id AS article_id
      FROM article_analysis
      INNER JOIN article_content
        ON article_content.workspace_id = article_analysis.workspace_id
       AND article_content.article_id = article_analysis.article_id
      WHERE ${whereClauses.join('\n        AND ')}
      ORDER BY
        article_analysis.risk_score DESC,
        article_content.published_at DESC,
        article_analysis.id ASC
    `)
    .all(...queryParameters);
}

function listReporterRows(db, filters) {
  const { whereClauses, queryParameters } = buildHighRiskWhereClause(filters);
  whereClauses.push('article_content.author_name IS NOT NULL');
  whereClauses.push("TRIM(article_content.author_name) <> ''");

  return db
    .prepare(`
      SELECT
        article_content.author_name AS label,
        article_analysis.id AS article_analysis_id,
        article_analysis.article_id AS article_id
      FROM article_analysis
      INNER JOIN article_content
        ON article_content.workspace_id = article_analysis.workspace_id
       AND article_content.article_id = article_analysis.article_id
      WHERE ${whereClauses.join('\n        AND ')}
      ORDER BY
        article_analysis.risk_score DESC,
        article_content.published_at DESC,
        article_analysis.id ASC
    `)
    .all(...queryParameters);
}

function normalizeAggregationLabel(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function choosePreferredLabel(currentLabel, candidateLabel) {
  if (!currentLabel) {
    return candidateLabel;
  }

  const currentKey = currentLabel.toLowerCase();
  const candidateKey = candidateLabel.toLowerCase();

  if (candidateKey < currentKey) {
    return candidateLabel;
  }

  if (candidateKey === currentKey && candidateLabel < currentLabel) {
    return candidateLabel;
  }

  return currentLabel;
}

function pushUnique(collection, seenValues, value) {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  collection.push(value);
}

function compareAggregates(left, right, fieldName) {
  if (right.highRiskArticleCount !== left.highRiskArticleCount) {
    return right.highRiskArticleCount - left.highRiskArticleCount;
  }

  const leftKey = left[fieldName].toLowerCase();
  const rightKey = right[fieldName].toLowerCase();

  if (leftKey !== rightKey) {
    return leftKey.localeCompare(rightKey);
  }

  return left[fieldName].localeCompare(right[fieldName]);
}

function aggregateRows(rows, fieldName) {
  const aggregatesByLabel = new Map();

  for (const row of rows) {
    const label = normalizeAggregationLabel(row.label);

    if (!label) {
      continue;
    }

    const normalizedKey = label.toLowerCase();
    let aggregate = aggregatesByLabel.get(normalizedKey);

    if (!aggregate) {
      aggregate = {
        [fieldName]: label,
        highRiskArticleCount: 0,
        articleIds: [],
        articleAnalysisIds: [],
        seenArticleIds: new Set(),
        seenArticleAnalysisIds: new Set(),
      };
      aggregatesByLabel.set(normalizedKey, aggregate);
    } else {
      aggregate[fieldName] = choosePreferredLabel(aggregate[fieldName], label);
    }

    pushUnique(aggregate.articleIds, aggregate.seenArticleIds, row.article_id);
    pushUnique(
      aggregate.articleAnalysisIds,
      aggregate.seenArticleAnalysisIds,
      row.article_analysis_id,
    );
    aggregate.highRiskArticleCount = aggregate.articleAnalysisIds.length;
  }

  return Array.from(aggregatesByLabel.values())
    .map((aggregate) => ({
      [fieldName]: aggregate[fieldName],
      highRiskArticleCount: aggregate.highRiskArticleCount,
      articleIds: aggregate.articleIds,
      articleAnalysisIds: aggregate.articleAnalysisIds,
    }))
    .sort((left, right) => compareAggregates(left, right, fieldName));
}

function normalizeAnalyticsFilters(options) {
  const normalizedWorkspaceId = normalizeRequiredString(options.workspaceId, 'workspaceId');
  const normalizedUserId = normalizeRequiredString(options.userId, 'userId');
  const normalizedMonitoringTargetId = normalizeOptionalString(
    options.monitoringTargetId,
    'monitoringTargetId',
  );
  const publishedFrom = normalizeTimestamp(options.publishedFrom, 'publishedFrom');
  const publishedTo = normalizeTimestamp(options.publishedTo, 'publishedTo');

  if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
    throw new ArticleAnalyticsQueryServiceError(
      'INVALID_INPUT',
      'publishedFrom must be earlier than or equal to publishedTo',
    );
  }

  return {
    workspaceId: normalizedWorkspaceId,
    userId: normalizedUserId,
    monitoringTargetId: normalizedMonitoringTargetId,
    publishedFrom,
    publishedTo,
  };
}

function buildAnalyticsAggregates(db, filters) {
  return {
    topicSummaries: aggregateRows(listTopicRows(db, filters), 'topicLabel'),
    publisherSummaries: aggregateRows(listPublisherRows(db, filters), 'publisherName'),
    reporterSummaries: aggregateRows(listReporterRows(db, filters), 'reporterName'),
  };
}

function getArticleAnalyticsAggregates(options) {
  const normalizedFilters = normalizeAnalyticsFilters(options);
  requireActiveWorkspaceMember(options.db, normalizedFilters.workspaceId, normalizedFilters.userId);

  return buildAnalyticsAggregates(options.db, normalizedFilters);
}

function getArticleAnalyticsDashboardPage(options) {
  const normalizedFilters = normalizeAnalyticsFilters(options);
  const workspace = getWorkspace(options.db, normalizedFilters.workspaceId);

  if (!workspace) {
    throw new ArticleAnalyticsQueryServiceError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
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
        publishedFrom: normalizeDateInputValue(options.publishedFrom),
        publishedTo: normalizeDateInputValue(options.publishedTo),
      },
      options: {
        monitoringTargets: listMonitoringTargets(options.db, normalizedFilters.workspaceId),
      },
    },
    analytics: buildAnalyticsAggregates(options.db, normalizedFilters),
  };
}

module.exports = {
  ArticleAnalyticsQueryServiceError,
  getArticleAnalyticsAggregates,
  getArticleAnalyticsDashboardPage,
};
