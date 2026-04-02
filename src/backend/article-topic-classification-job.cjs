'use strict';

const { randomUUID } = require('node:crypto');

const { completedArticleIngestionStatus } = require('../db/schema/article-ingestion.cjs');

class ArticleTopicClassificationJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleTopicClassificationJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleTopicClassificationJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleTopicClassificationJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeTopicLabels(value) {
  if (!Array.isArray(value)) {
    throw new ArticleTopicClassificationJobError('INVALID_INPUT', 'topicLabels must be an array');
  }

  const normalizedLabels = [];
  const seenLabels = new Set();

  for (const [index, topicLabel] of value.entries()) {
    const normalizedLabel = normalizeRequiredString(topicLabel, `topicLabels[${index}]`);
    const dedupeKey = normalizedLabel.toLowerCase();

    if (seenLabels.has(dedupeKey)) {
      continue;
    }

    seenLabels.add(dedupeKey);
    normalizedLabels.push(normalizedLabel);
  }

  if (normalizedLabels.length === 0) {
    throw new ArticleTopicClassificationJobError(
      'INVALID_INPUT',
      'topicLabels must contain at least one label',
    );
  }

  return normalizedLabels;
}

function normalizeClassificationResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ArticleTopicClassificationJobError(
      'INVALID_INPUT',
      'classifyArticleTopics must resolve to an object',
    );
  }

  return {
    topicLabels: normalizeTopicLabels(result.topicLabels),
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

function listClassifiableArticles(db) {
  return db
    .prepare(`
      SELECT DISTINCT
             c.workspace_id,
             c.monitoring_target_id,
             c.article_id,
             t.type,
             t.display_name,
             t.note,
             t.status,
             t.default_risk_threshold,
             a.source_url,
             a.canonical_url,
             a.ingestion_status,
             ac.title,
             ac.body_text,
             ac.author_name,
             ac.publisher_name,
             ac.published_at,
             ac.view_count,
             ac.fetched_at,
             aa.topics_classified_at
      FROM article_candidate c
      JOIN monitoring_target t
        ON t.workspace_id = c.workspace_id
       AND t.id = c.monitoring_target_id
      JOIN article a
        ON a.workspace_id = c.workspace_id
       AND a.id = c.article_id
      JOIN article_content ac
        ON ac.workspace_id = c.workspace_id
       AND ac.article_id = c.article_id
      LEFT JOIN article_analysis aa
        ON aa.workspace_id = c.workspace_id
       AND aa.monitoring_target_id = c.monitoring_target_id
       AND aa.article_id = c.article_id
      WHERE c.article_id IS NOT NULL
        AND a.ingestion_status = ?
      ORDER BY c.workspace_id, c.monitoring_target_id, c.article_id
    `)
    .all(completedArticleIngestionStatus);
}

function shouldClassifyTopics(row) {
  return row.topics_classified_at == null;
}

function normalizeMonitoringTargetRow(row) {
  return {
    id: row.monitoring_target_id,
    workspaceId: row.workspace_id,
    type: row.type,
    displayName: row.display_name,
    note: row.note,
    status: row.status,
    defaultRiskThreshold: row.default_risk_threshold,
  };
}

function normalizeArticleRow(row) {
  return {
    id: row.article_id,
    workspaceId: row.workspace_id,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    ingestionStatus: row.ingestion_status,
    title: row.title,
    bodyText: row.body_text,
    authorName: row.author_name,
    publisherName: row.publisher_name,
    publishedAt: row.published_at,
    viewCount: row.view_count,
    fetchedAt: row.fetched_at,
  };
}

function getArticleAnalysis(db, workspaceId, monitoringTargetId, articleId) {
  return db
    .prepare(`
      SELECT id
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get(workspaceId, monitoringTargetId, articleId);
}

function upsertArticleAnalysis(db, analysis) {
  if (analysis.exists) {
    db.prepare(`
      UPDATE article_analysis
      SET topic_labels = ?,
          topics_classified_at = ?,
          updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      analysis.topicLabelsJson,
      analysis.topicsClassifiedAt,
      analysis.updatedAt,
      analysis.workspaceId,
      analysis.id,
    );

    return;
  }

  db.prepare(`
    INSERT INTO article_analysis (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      topic_labels,
      topics_classified_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    analysis.id,
    analysis.workspaceId,
    analysis.monitoringTargetId,
    analysis.articleId,
    analysis.topicLabelsJson,
    analysis.topicsClassifiedAt,
    analysis.createdAt,
    analysis.updatedAt,
  );
}

function replaceArticleAnalysisTopicLabels(db, analysis) {
  db.prepare(`
    DELETE FROM article_analysis_topic_label
    WHERE workspace_id = ? AND article_analysis_id = ?
  `).run(analysis.workspaceId, analysis.articleAnalysisId);

  const insertTopicLabel = db.prepare(`
    INSERT INTO article_analysis_topic_label (
      workspace_id,
      article_analysis_id,
      topic_label,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const topicLabel of analysis.topicLabels) {
    insertTopicLabel.run(
      analysis.workspaceId,
      analysis.articleAnalysisId,
      topicLabel,
      analysis.persistedAt,
      analysis.persistedAt,
    );
  }
}

async function runArticleTopicClassificationJob({
  db,
  classifyArticleTopics,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  if (typeof classifyArticleTopics !== 'function') {
    throw new ArticleTopicClassificationJobError(
      'INVALID_INPUT',
      'classifyArticleTopics must be a function',
    );
  }

  const processedAnalyses = [];

  for (const row of listClassifiableArticles(db)) {
    if (!shouldClassifyTopics(row)) {
      continue;
    }

    const monitoringTarget = normalizeMonitoringTargetRow(row);
    const article = normalizeArticleRow(row);
    const classificationResult = normalizeClassificationResult(
      await classifyArticleTopics({
        monitoringTarget: { ...monitoringTarget },
        article: { ...article },
      }),
    );

    const persistedAnalysis = runInTransaction(db, () => {
      const persistedAt = now();
      const existingAnalysis = getArticleAnalysis(
        db,
        monitoringTarget.workspaceId,
        monitoringTarget.id,
        article.id,
      );
      const articleAnalysisId = existingAnalysis ? existingAnalysis.id : createId();

      upsertArticleAnalysis(db, {
        id: articleAnalysisId,
        exists: Boolean(existingAnalysis),
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        topicLabelsJson: JSON.stringify(classificationResult.topicLabels),
        topicsClassifiedAt: persistedAt,
        createdAt: persistedAt,
        updatedAt: persistedAt,
      });
      replaceArticleAnalysisTopicLabels(db, {
        workspaceId: monitoringTarget.workspaceId,
        articleAnalysisId,
        topicLabels: classificationResult.topicLabels,
        persistedAt,
      });

      return {
        analysisId: articleAnalysisId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        topicLabels: classificationResult.topicLabels,
        topicsClassifiedAt: persistedAt,
      };
    });

    processedAnalyses.push(persistedAnalysis);
  }

  return {
    processedAnalyses,
    totalProcessed: processedAnalyses.length,
    classifiedAnalyses: processedAnalyses.length,
  };
}

module.exports = {
  ArticleTopicClassificationJobError,
  runArticleTopicClassificationJob,
};
