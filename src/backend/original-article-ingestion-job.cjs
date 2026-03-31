'use strict';

const { createHash, randomUUID } = require('node:crypto');

const {
  completedArticleIngestionStatus,
  defaultArticleCandidateIngestionStatus,
  failedArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
} = require('../db/schema/article-ingestion.cjs');

class OriginalArticleIngestionJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OriginalArticleIngestionJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new OriginalArticleIngestionJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new OriginalArticleIngestionJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new OriginalArticleIngestionJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeOptionalInteger(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new OriginalArticleIngestionJobError(
      'INVALID_INPUT',
      `${fieldName} must be a non-negative integer`,
    );
  }

  return value;
}

function normalizeFetchedArticle(article, fallbackSourceUrl) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) {
    throw new OriginalArticleIngestionJobError(
      'INVALID_INPUT',
      'fetchOriginalArticle must return an object',
    );
  }

  return {
    sourceUrl: normalizeOptionalString(article.sourceUrl, 'sourceUrl') ?? fallbackSourceUrl,
    canonicalUrl: normalizeOptionalString(article.canonicalUrl, 'canonicalUrl'),
    title: normalizeRequiredString(article.title, 'title'),
    bodyText: normalizeRequiredString(article.bodyText, 'bodyText'),
    authorName: normalizeOptionalString(article.authorName, 'authorName'),
    publisherName: normalizeOptionalString(article.publisherName, 'publisherName'),
    publishedAt: normalizeOptionalString(article.publishedAt, 'publishedAt'),
    viewCount: normalizeOptionalInteger(article.viewCount, 'viewCount'),
  };
}

function normalizeHashInput(value) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function hashNormalizedText(value) {
  return createHash('sha256').update(normalizeHashInput(value), 'utf8').digest('hex');
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

function listIngestibleCandidates(db) {
  return db
    .prepare(`
      SELECT c.id, c.workspace_id, c.monitoring_target_id, c.portal_url, c.source_url, c.ingestion_status,
             m.portal_name, m.portal_title, m.portal_snippet, m.portal_published_at
      FROM article_candidate c
      LEFT JOIN article_candidate_portal_metadata m
        ON m.workspace_id = c.workspace_id
       AND m.article_candidate_id = c.id
      WHERE c.source_url IS NOT NULL
        AND c.article_id IS NULL
        AND c.ingestion_status IN (?, ?)
      ORDER BY c.created_at, c.id
    `)
    .all(defaultArticleCandidateIngestionStatus, failedArticleCandidateIngestionStatus);
}

function normalizeArticleCandidateRow(candidate) {
  return {
    id: candidate.id,
    workspaceId: candidate.workspace_id,
    monitoringTargetId: candidate.monitoring_target_id,
    portalUrl: candidate.portal_url,
    sourceUrl: candidate.source_url,
    ingestionStatus: candidate.ingestion_status,
    portalMetadata: candidate.portal_name
      ? {
          portalName: candidate.portal_name,
          title: candidate.portal_title,
          snippet: candidate.portal_snippet,
          publishedAt: candidate.portal_published_at,
        }
      : null,
  };
}

function findArticleBySourceUrl(db, workspaceId, sourceUrl) {
  if (!sourceUrl) {
    return null;
  }

  return db
    .prepare(`
      SELECT id, source_url, canonical_url, normalized_title_hash, body_hash, ingestion_status
      FROM article
      WHERE workspace_id = ? AND source_url = ?
    `)
    .get(workspaceId, sourceUrl);
}

function findArticleByCanonicalUrl(db, workspaceId, canonicalUrl) {
  if (!canonicalUrl) {
    return null;
  }

  return db
    .prepare(`
      SELECT id, source_url, canonical_url, normalized_title_hash, body_hash, ingestion_status
      FROM article
      WHERE workspace_id = ? AND canonical_url = ?
    `)
    .get(workspaceId, canonicalUrl);
}

function findArticleByTitleBodyHashes(db, workspaceId, normalizedTitleHash, bodyHash) {
  return db
    .prepare(`
      SELECT id, source_url, canonical_url, normalized_title_hash, body_hash, ingestion_status
      FROM article
      WHERE workspace_id = ?
        AND normalized_title_hash = ?
        AND body_hash = ?
    `)
    .get(workspaceId, normalizedTitleHash, bodyHash);
}

function findMatchingArticle(db, workspaceId, sourceUrl, canonicalUrl, normalizedTitleHash, bodyHash) {
  for (const article of [
    findArticleBySourceUrl(db, workspaceId, sourceUrl),
    findArticleByCanonicalUrl(db, workspaceId, canonicalUrl),
    findArticleByTitleBodyHashes(db, workspaceId, normalizedTitleHash, bodyHash),
  ]) {
    if (article) {
      return article;
    }
  }

  return null;
}

function upsertArticle(db, article) {
  if (article.existingArticle) {
    db.prepare(`
      UPDATE article
      SET source_url = CASE
            WHEN source_url IS NULL THEN ?
            ELSE source_url
          END,
          canonical_url = CASE
            WHEN canonical_url IS NULL THEN ?
            ELSE canonical_url
          END,
          normalized_title_hash = ?,
          body_hash = ?,
          ingestion_status = ?,
          ingestion_error = NULL,
          updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      article.sourceUrl,
      article.canonicalUrl,
      article.normalizedTitleHash,
      article.bodyHash,
      completedArticleIngestionStatus,
      article.persistedAt,
      article.workspaceId,
      article.existingArticle.id,
    );

    return article.existingArticle.id;
  }

  const articleId = article.createId();

  db.prepare(`
    INSERT INTO article (
      id,
      workspace_id,
      source_url,
      canonical_url,
      normalized_title_hash,
      body_hash,
      ingestion_status,
      ingestion_error,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId,
    article.workspaceId,
    article.sourceUrl,
    article.canonicalUrl,
    article.normalizedTitleHash,
    article.bodyHash,
    completedArticleIngestionStatus,
    null,
    article.persistedAt,
    article.persistedAt,
  );

  return articleId;
}

function upsertArticleContent(db, content) {
  db.prepare(`
    INSERT INTO article_content (
      article_id,
      workspace_id,
      title,
      body_text,
      author_name,
      publisher_name,
      published_at,
      view_count,
      fetched_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (article_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      title = excluded.title,
      body_text = excluded.body_text,
      author_name = excluded.author_name,
      publisher_name = excluded.publisher_name,
      published_at = excluded.published_at,
      view_count = excluded.view_count,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at
  `).run(
    content.articleId,
    content.workspaceId,
    content.title,
    content.bodyText,
    content.authorName,
    content.publisherName,
    content.publishedAt,
    content.viewCount,
    content.fetchedAt,
    content.createdAt,
    content.updatedAt,
  );
}

function linkArticleCandidate(db, candidate) {
  db.prepare(`
    UPDATE article_candidate
    SET article_id = ?,
        source_url = ?,
        ingestion_status = ?,
        ingestion_error = NULL,
        updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    candidate.articleId,
    candidate.sourceUrl,
    linkedArticleCandidateIngestionStatus,
    candidate.updatedAt,
    candidate.workspaceId,
    candidate.id,
  );
}

function markArticleCandidateFailed(db, candidate, errorMessage, updatedAt) {
  db.prepare(`
    UPDATE article_candidate
    SET ingestion_status = ?,
        ingestion_error = ?,
        updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    failedArticleCandidateIngestionStatus,
    errorMessage,
    updatedAt,
    candidate.workspaceId,
    candidate.id,
  );
}

function normalizeFailureReason(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Original article ingestion failed';
}

async function runOriginalArticleIngestionJob({
  db,
  fetchOriginalArticle,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  if (typeof fetchOriginalArticle !== 'function') {
    throw new OriginalArticleIngestionJobError(
      'INVALID_INPUT',
      'fetchOriginalArticle must be a function',
    );
  }

  const processedCandidates = [];

  for (const row of listIngestibleCandidates(db)) {
    const articleCandidate = normalizeArticleCandidateRow(row);

    try {
      const fetchedArticle = normalizeFetchedArticle(
        await fetchOriginalArticle({ articleCandidate }),
        articleCandidate.sourceUrl,
      );

      const persistedCandidate = runInTransaction(db, () => {
        const persistedAt = now();
        const normalizedTitleHash = hashNormalizedText(fetchedArticle.title);
        const bodyHash = hashNormalizedText(fetchedArticle.bodyText);
        const existingArticle = findMatchingArticle(
          db,
          articleCandidate.workspaceId,
          fetchedArticle.sourceUrl,
          fetchedArticle.canonicalUrl,
          normalizedTitleHash,
          bodyHash,
        );
        const articleId = upsertArticle(db, {
          workspaceId: articleCandidate.workspaceId,
          sourceUrl: fetchedArticle.sourceUrl,
          canonicalUrl: fetchedArticle.canonicalUrl,
          normalizedTitleHash,
          bodyHash,
          persistedAt,
          existingArticle,
          createId,
        });

        upsertArticleContent(db, {
          articleId,
          workspaceId: articleCandidate.workspaceId,
          title: fetchedArticle.title,
          bodyText: fetchedArticle.bodyText,
          authorName: fetchedArticle.authorName,
          publisherName: fetchedArticle.publisherName,
          publishedAt: fetchedArticle.publishedAt,
          viewCount: fetchedArticle.viewCount,
          fetchedAt: persistedAt,
          createdAt: persistedAt,
          updatedAt: persistedAt,
        });
        linkArticleCandidate(db, {
          id: articleCandidate.id,
          workspaceId: articleCandidate.workspaceId,
          sourceUrl: fetchedArticle.sourceUrl,
          articleId,
          updatedAt: persistedAt,
        });

        return {
          id: articleCandidate.id,
          workspaceId: articleCandidate.workspaceId,
          monitoringTargetId: articleCandidate.monitoringTargetId,
          articleId,
          sourceUrl: fetchedArticle.sourceUrl,
          canonicalUrl: fetchedArticle.canonicalUrl,
          ingestionStatus: linkedArticleCandidateIngestionStatus,
          articleIngestionStatus: completedArticleIngestionStatus,
          normalizedTitleHash,
          bodyHash,
        };
      });

      processedCandidates.push(persistedCandidate);
    } catch (error) {
      const updatedAt = now();
      const ingestionError = normalizeFailureReason(error);

      markArticleCandidateFailed(db, articleCandidate, ingestionError, updatedAt);

      processedCandidates.push({
        id: articleCandidate.id,
        workspaceId: articleCandidate.workspaceId,
        monitoringTargetId: articleCandidate.monitoringTargetId,
        articleId: null,
        sourceUrl: articleCandidate.sourceUrl,
        canonicalUrl: null,
        ingestionStatus: failedArticleCandidateIngestionStatus,
        articleIngestionStatus: null,
        normalizedTitleHash: null,
        bodyHash: null,
        ingestionError,
      });
    }
  }

  return {
    processedCandidates,
    totalProcessed: processedCandidates.length,
    linkedCandidates: processedCandidates.filter(
      (candidate) => candidate.ingestionStatus === linkedArticleCandidateIngestionStatus,
    ).length,
    failedCandidates: processedCandidates.filter(
      (candidate) => candidate.ingestionStatus === failedArticleCandidateIngestionStatus,
    ).length,
  };
}

module.exports = {
  OriginalArticleIngestionJobError,
  hashNormalizedText,
  runOriginalArticleIngestionJob,
};
