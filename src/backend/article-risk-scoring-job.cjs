'use strict';

const { randomUUID } = require('node:crypto');

const { completedArticleIngestionStatus } = require('../db/schema/article-ingestion.cjs');
const { getArticleAnalysisRiskBand } = require('../db/schema/analysis-alert.cjs');

class ArticleRiskScoringJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleRiskScoringJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleRiskScoringJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleRiskScoringJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeRiskScore(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new ArticleRiskScoringJobError(
      'INVALID_INPUT',
      'riskScore must be an integer between 0 and 100',
    );
  }

  return value;
}

function normalizeRiskScoringResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ArticleRiskScoringJobError(
      'INVALID_INPUT',
      'scoreArticleRisk must resolve to an object',
    );
  }

  const riskScore = normalizeRiskScore(result.riskScore);

  return {
    riskScore,
    riskBand: getArticleAnalysisRiskBand(riskScore),
    rationale: normalizeRequiredString(result.rationale, 'rationale').replace(/\s+/gu, ' '),
    modelVersion: normalizeRequiredString(result.modelVersion, 'modelVersion'),
  };
}

function normalizeReanalysisRequests(reanalysisRequests) {
  if (reanalysisRequests == null) {
    return new Set();
  }

  if (!Array.isArray(reanalysisRequests)) {
    throw new ArticleRiskScoringJobError(
      'INVALID_INPUT',
      'reanalysisRequests must be an array',
    );
  }

  const normalizedRequests = new Set();

  for (const [index, request] of reanalysisRequests.entries()) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new ArticleRiskScoringJobError(
        'INVALID_INPUT',
        `reanalysisRequests[${index}] must be an object`,
      );
    }

    normalizedRequests.add(
      createAnalysisKey(
        normalizeRequiredString(request.workspaceId, `reanalysisRequests[${index}].workspaceId`),
        normalizeRequiredString(
          request.monitoringTargetId,
          `reanalysisRequests[${index}].monitoringTargetId`,
        ),
        normalizeRequiredString(request.articleId, `reanalysisRequests[${index}].articleId`),
      ),
    );
  }

  return normalizedRequests;
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

    return parsedValue.filter((topicLabel) => typeof topicLabel === 'string');
  } catch {
    return [];
  }
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultCreateId() {
  return randomUUID();
}

function createAnalysisKey(workspaceId, monitoringTargetId, articleId) {
  return `${workspaceId}\u0000${monitoringTargetId}\u0000${articleId}`;
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

function listRiskScorableArticles(db) {
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
             aa.id AS analysis_id,
             aa.relevance_score,
             aa.topic_labels,
             aa.summary,
             aa.risk_score,
             aa.risk_band,
             aa.rationale,
             aa.model_version AS analysis_model_version,
             aa.relevance_scored_at,
             aa.topics_classified_at,
             aa.summary_generated_at,
             aa.risk_scored_at
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

function normalizeExistingAnalysisRow(row) {
  if (typeof row.analysis_id !== 'string') {
    return null;
  }

  return {
    id: row.analysis_id,
    relevanceScore: row.relevance_score,
    topicLabels: parseTopicLabels(row.topic_labels),
    summary: row.summary,
    riskScore: row.risk_score,
    riskBand: row.risk_band,
    rationale: row.rationale,
    modelVersion: row.analysis_model_version,
    relevanceScoredAt: row.relevance_scored_at,
    topicsClassifiedAt: row.topics_classified_at,
    summaryGeneratedAt: row.summary_generated_at,
    riskScoredAt: row.risk_scored_at,
  };
}

function shouldScoreRisk(row, requestedAnalyses) {
  const analysisKey = createAnalysisKey(row.workspace_id, row.monitoring_target_id, row.article_id);

  if (requestedAnalyses.has(analysisKey)) {
    return true;
  }

  if (!Number.isInteger(row.risk_score)) {
    return true;
  }

  if (typeof row.risk_band !== 'string' || row.risk_band.trim().length === 0) {
    return true;
  }

  if (typeof row.rationale !== 'string' || row.rationale.trim().length === 0) {
    return true;
  }

  return row.risk_scored_at == null;
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
      SET risk_score = ?,
          risk_band = ?,
          rationale = ?,
          model_version = ?,
          risk_scored_at = ?,
          updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      analysis.riskScore,
      analysis.riskBand,
      analysis.rationale,
      analysis.modelVersion,
      analysis.riskScoredAt,
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
      risk_score,
      risk_band,
      rationale,
      model_version,
      risk_scored_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    analysis.id,
    analysis.workspaceId,
    analysis.monitoringTargetId,
    analysis.articleId,
    analysis.riskScore,
    analysis.riskBand,
    analysis.rationale,
    analysis.modelVersion,
    analysis.riskScoredAt,
    analysis.createdAt,
    analysis.updatedAt,
  );
}

async function runArticleRiskScoringJob({
  db,
  scoreArticleRisk,
  reanalysisRequests,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  if (typeof scoreArticleRisk !== 'function') {
    throw new ArticleRiskScoringJobError(
      'INVALID_INPUT',
      'scoreArticleRisk must be a function',
    );
  }

  const requestedAnalyses = normalizeReanalysisRequests(reanalysisRequests);
  const processedAnalyses = [];

  for (const row of listRiskScorableArticles(db)) {
    if (!shouldScoreRisk(row, requestedAnalyses)) {
      continue;
    }

    const monitoringTarget = normalizeMonitoringTargetRow(row);
    const article = normalizeArticleRow(row);
    const articleAnalysis = normalizeExistingAnalysisRow(row);
    const scoringResult = normalizeRiskScoringResult(
      await scoreArticleRisk({
        monitoringTarget: { ...monitoringTarget },
        article: { ...article },
        articleAnalysis: articleAnalysis
          ? {
              ...articleAnalysis,
              topicLabels: articleAnalysis.topicLabels.slice(),
            }
          : null,
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
        riskScore: scoringResult.riskScore,
        riskBand: scoringResult.riskBand,
        rationale: scoringResult.rationale,
        modelVersion: scoringResult.modelVersion,
        riskScoredAt: persistedAt,
        createdAt: persistedAt,
        updatedAt: persistedAt,
      });

      return {
        analysisId: articleAnalysisId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        riskScore: scoringResult.riskScore,
        riskBand: scoringResult.riskBand,
        rationale: scoringResult.rationale,
        modelVersion: scoringResult.modelVersion,
        riskScoredAt: persistedAt,
      };
    });

    processedAnalyses.push(persistedAnalysis);
  }

  return {
    processedAnalyses,
    totalProcessed: processedAnalyses.length,
    riskScoredAnalyses: processedAnalyses.length,
  };
}

module.exports = {
  ArticleRiskScoringJobError,
  runArticleRiskScoringJob,
};
