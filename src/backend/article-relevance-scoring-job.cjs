'use strict';

const { randomUUID } = require('node:crypto');

const { getMonitoringTargetCollectorInput } = require('./monitoring-target-service.cjs');
const { completedArticleIngestionStatus } = require('../db/schema/article-ingestion.cjs');
const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../db/schema/analysis-alert.cjs');

class ArticleRelevanceScoringJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleRelevanceScoringJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleRelevanceScoringJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleRelevanceScoringJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ArticleRelevanceScoringJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeRelevanceScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ArticleRelevanceScoringJobError(
      'INVALID_INPUT',
      'relevanceScore must be a finite number between 0 and 1',
    );
  }

  return value;
}

function normalizeSignalValues(values, fieldName) {
  if (values == null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new ArticleRelevanceScoringJobError('INVALID_INPUT', `${fieldName} must be an array`);
  }

  const normalizedValues = [];
  const seenValues = new Set();

  for (const [index, value] of values.entries()) {
    const normalizedValue = normalizeRequiredString(value, `${fieldName}[${index}]`);
    const dedupeKey = normalizedValue.toLowerCase();

    if (seenValues.has(dedupeKey)) {
      continue;
    }

    seenValues.add(dedupeKey);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function normalizeScoringResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ArticleRelevanceScoringJobError(
      'INVALID_INPUT',
      'scoreArticleRelevance must resolve to an object',
    );
  }

  return {
    relevanceScore: normalizeRelevanceScore(result.relevanceScore),
    matchedKeywords: normalizeSignalValues(result.matchedKeywords, 'matchedKeywords'),
    entitySignals: normalizeSignalValues(result.entitySignals, 'entitySignals'),
    modelVersion: normalizeOptionalString(result.modelVersion, 'modelVersion'),
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

function listScorableArticles(db) {
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
             ac.fetched_at
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
      WHERE c.article_id IS NOT NULL
        AND a.ingestion_status = ?
      ORDER BY c.workspace_id, c.monitoring_target_id, c.article_id
    `)
    .all(completedArticleIngestionStatus);
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

function cloneCollectorInput(collectorInput) {
  return {
    workspaceId: collectorInput.workspaceId,
    monitoringTargetId: collectorInput.monitoringTargetId,
    seedKeywords: collectorInput.seedKeywords.map((keyword) => ({ ...keyword })),
    expandedKeywords: collectorInput.expandedKeywords.map((keyword) => ({ ...keyword })),
    excludedKeywords: collectorInput.excludedKeywords.map((keyword) => ({ ...keyword })),
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
      SET relevance_score = ?,
          model_version = ?,
          relevance_scored_at = ?,
          updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      analysis.relevanceScore,
      analysis.modelVersion,
      analysis.relevanceScoredAt,
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
      relevance_score,
      model_version,
      relevance_scored_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    analysis.id,
    analysis.workspaceId,
    analysis.monitoringTargetId,
    analysis.articleId,
    analysis.relevanceScore,
    analysis.modelVersion,
    analysis.relevanceScoredAt,
    analysis.createdAt,
    analysis.updatedAt,
  );
}

function replaceArticleAnalysisRelevanceSignals(db, analysis) {
  db.prepare(`
    DELETE FROM article_analysis_relevance_signal
    WHERE workspace_id = ? AND article_analysis_id = ?
  `).run(analysis.workspaceId, analysis.articleAnalysisId);

  const insertSignal = db.prepare(`
    INSERT INTO article_analysis_relevance_signal (
      workspace_id,
      article_analysis_id,
      signal_type,
      signal_value,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const signalValue of analysis.matchedKeywords) {
    insertSignal.run(
      analysis.workspaceId,
      analysis.articleAnalysisId,
      keywordArticleAnalysisRelevanceSignalType,
      signalValue,
      analysis.persistedAt,
      analysis.persistedAt,
    );
  }

  for (const signalValue of analysis.entitySignals) {
    insertSignal.run(
      analysis.workspaceId,
      analysis.articleAnalysisId,
      entityArticleAnalysisRelevanceSignalType,
      signalValue,
      analysis.persistedAt,
      analysis.persistedAt,
    );
  }
}

async function runArticleRelevanceScoringJob({
  db,
  scoreArticleRelevance,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  if (typeof scoreArticleRelevance !== 'function') {
    throw new ArticleRelevanceScoringJobError(
      'INVALID_INPUT',
      'scoreArticleRelevance must be a function',
    );
  }

  const processedAnalyses = [];

  for (const row of listScorableArticles(db)) {
    const monitoringTarget = normalizeMonitoringTargetRow(row);
    const article = normalizeArticleRow(row);
    const collectorInput = cloneCollectorInput(
      getMonitoringTargetCollectorInput({
        db,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
      }),
    );
    const scoringResult = normalizeScoringResult(
      await scoreArticleRelevance({
        monitoringTarget: { ...monitoringTarget },
        article: { ...article },
        collectorInput,
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
        relevanceScore: scoringResult.relevanceScore,
        modelVersion: scoringResult.modelVersion,
        relevanceScoredAt: persistedAt,
        createdAt: persistedAt,
        updatedAt: persistedAt,
      });
      replaceArticleAnalysisRelevanceSignals(db, {
        workspaceId: monitoringTarget.workspaceId,
        articleAnalysisId,
        matchedKeywords: scoringResult.matchedKeywords,
        entitySignals: scoringResult.entitySignals,
        persistedAt,
      });

      return {
        analysisId: articleAnalysisId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        relevanceScore: scoringResult.relevanceScore,
        matchedKeywords: scoringResult.matchedKeywords,
        entitySignals: scoringResult.entitySignals,
        modelVersion: scoringResult.modelVersion,
        relevanceScoredAt: persistedAt,
      };
    });

    processedAnalyses.push(persistedAnalysis);
  }

  return {
    processedAnalyses,
    totalProcessed: processedAnalyses.length,
    scoredAnalyses: processedAnalyses.length,
  };
}

module.exports = {
  ArticleRelevanceScoringJobError,
  runArticleRelevanceScoringJob,
};
