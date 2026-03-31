'use strict';

const { randomUUID } = require('node:crypto');

const { completedArticleIngestionStatus } = require('../db/schema/article-ingestion.cjs');

class ArticleSummaryGenerationJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArticleSummaryGenerationJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ArticleSummaryGenerationJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ArticleSummaryGenerationJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function countSummarySentences(summary) {
  const sentences = summary.match(/[^.!?]+(?:[.!?]+|$)/gu);

  if (!sentences) {
    return 0;
  }

  return sentences.map((sentence) => sentence.trim()).filter(Boolean).length;
}

function normalizeGenerationResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ArticleSummaryGenerationJobError(
      'INVALID_INPUT',
      'generateArticleSummary must resolve to an object',
    );
  }

  const summary = normalizeRequiredString(result.summary, 'summary').replace(/\s+/gu, ' ');

  if (countSummarySentences(summary) > 3) {
    throw new ArticleSummaryGenerationJobError(
      'INVALID_INPUT',
      'summary must contain at most 3 sentences',
    );
  }

  return {
    summary,
    modelVersion: normalizeRequiredString(result.modelVersion, 'modelVersion'),
  };
}

function normalizeReanalysisRequests(reanalysisRequests) {
  if (reanalysisRequests == null) {
    return new Set();
  }

  if (!Array.isArray(reanalysisRequests)) {
    throw new ArticleSummaryGenerationJobError(
      'INVALID_INPUT',
      'reanalysisRequests must be an array',
    );
  }

  const normalizedRequests = new Set();

  for (const [index, request] of reanalysisRequests.entries()) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new ArticleSummaryGenerationJobError(
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

function listSummarizableArticles(db) {
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
             aa.summary,
             aa.summary_generated_at
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

function shouldGenerateSummary(row, requestedAnalyses) {
  const analysisKey = createAnalysisKey(row.workspace_id, row.monitoring_target_id, row.article_id);

  if (requestedAnalyses.has(analysisKey)) {
    return true;
  }

  if (typeof row.summary !== 'string') {
    return true;
  }

  return row.summary.trim().length === 0 || row.summary_generated_at == null;
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
      SET summary = ?,
          model_version = ?,
          summary_generated_at = ?,
          updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      analysis.summary,
      analysis.modelVersion,
      analysis.summaryGeneratedAt,
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
      summary,
      model_version,
      summary_generated_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    analysis.id,
    analysis.workspaceId,
    analysis.monitoringTargetId,
    analysis.articleId,
    analysis.summary,
    analysis.modelVersion,
    analysis.summaryGeneratedAt,
    analysis.createdAt,
    analysis.updatedAt,
  );
}

async function runArticleSummaryGenerationJob({
  db,
  generateArticleSummary,
  reanalysisRequests,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  if (typeof generateArticleSummary !== 'function') {
    throw new ArticleSummaryGenerationJobError(
      'INVALID_INPUT',
      'generateArticleSummary must be a function',
    );
  }

  const requestedAnalyses = normalizeReanalysisRequests(reanalysisRequests);
  const processedAnalyses = [];

  for (const row of listSummarizableArticles(db)) {
    if (!shouldGenerateSummary(row, requestedAnalyses)) {
      continue;
    }

    const monitoringTarget = normalizeMonitoringTargetRow(row);
    const article = normalizeArticleRow(row);
    const summaryResult = normalizeGenerationResult(
      await generateArticleSummary({
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
        summary: summaryResult.summary,
        modelVersion: summaryResult.modelVersion,
        summaryGeneratedAt: persistedAt,
        createdAt: persistedAt,
        updatedAt: persistedAt,
      });

      return {
        analysisId: articleAnalysisId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        summary: summaryResult.summary,
        modelVersion: summaryResult.modelVersion,
        summaryGeneratedAt: persistedAt,
      };
    });

    processedAnalyses.push(persistedAnalysis);
  }

  return {
    processedAnalyses,
    totalProcessed: processedAnalyses.length,
    summarizedAnalyses: processedAnalyses.length,
  };
}

module.exports = {
  ArticleSummaryGenerationJobError,
  runArticleSummaryGenerationJob,
};
