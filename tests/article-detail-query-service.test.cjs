'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  ArticleDetailQueryServiceError,
  getArticleDetail,
} = require('../src/backend/article-detail-query-service.cjs');
const { completedArticleIngestionStatus } = require('../src/db/schema/article-ingestion.cjs');
const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../src/db/schema/analysis-alert.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertUser(db, { id, email, displayName }) {
  db.prepare(`
    INSERT INTO user_account (id, email, display_name)
    VALUES (?, ?, ?)
  `).run(id, email, displayName);
}

function insertWorkspace(db, { id, slug, name }) {
  db.prepare(`
    INSERT INTO workspace (id, slug, name)
    VALUES (?, ?, ?)
  `).run(id, slug, name);
}

function insertMembership(db, { id, workspaceId, userId, role = 'member', status = 'active' }) {
  db.prepare(`
    INSERT INTO workspace_membership (id, workspace_id, user_id, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, userId, role, status);
}

function insertMonitoringTarget(
  db,
  {
    id,
    workspaceId,
    type = 'company',
    displayName,
    note = null,
    status = 'active',
    defaultRiskThreshold = 70,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target (
      id,
      workspace_id,
      type,
      display_name,
      note,
      status,
      default_risk_threshold
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, type, displayName, note, status, defaultRiskThreshold);
}

function insertArticle(
  db,
  {
    id,
    workspaceId,
    sourceUrl = null,
    canonicalUrl = null,
    normalizedTitleHash = null,
    bodyHash = null,
    ingestionStatus = completedArticleIngestionStatus,
  },
) {
  db.prepare(`
    INSERT INTO article (
      id,
      workspace_id,
      source_url,
      canonical_url,
      normalized_title_hash,
      body_hash,
      ingestion_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    sourceUrl,
    canonicalUrl,
    normalizedTitleHash,
    bodyHash,
    ingestionStatus,
  );
}

function insertArticleContent(
  db,
  {
    articleId,
    workspaceId,
    title,
    bodyText = 'Body text',
    authorName = null,
    publisherName = null,
    publishedAt = null,
    fetchedAt = '2026-03-31T00:00:00.000Z',
  },
) {
  db.prepare(`
    INSERT INTO article_content (
      article_id,
      workspace_id,
      title,
      body_text,
      author_name,
      publisher_name,
      published_at,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName,
    publisherName,
    publishedAt,
    fetchedAt,
  );
}

function insertArticleAnalysis(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    relevanceScore = 0.9,
    topicLabels = '[]',
    summary = null,
    riskScore = null,
    riskBand = null,
    rationale = null,
    modelVersion = 'gpt-5.4',
    relevanceScoredAt = '2026-03-31T00:01:00.000Z',
    topicsClassifiedAt = '2026-03-31T00:02:00.000Z',
    summaryGeneratedAt = null,
    riskScoredAt = null,
    createdAt = '2026-03-31T00:01:00.000Z',
    updatedAt = '2026-03-31T00:02:00.000Z',
  },
) {
  db.prepare(`
    INSERT INTO article_analysis (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      relevance_score,
      topic_labels,
      summary,
      risk_score,
      risk_band,
      rationale,
      model_version,
      relevance_scored_at,
      topics_classified_at,
      summary_generated_at,
      risk_scored_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    relevanceScore,
    topicLabels,
    summary,
    riskScore,
    riskBand,
    rationale,
    modelVersion,
    relevanceScoredAt,
    topicsClassifiedAt,
    summaryGeneratedAt,
    riskScoredAt,
    createdAt,
    updatedAt,
  );
}

function insertArticleCandidate(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    portalUrl,
    sourceUrl = null,
    ingestionStatus = 'linked',
  },
) {
  db.prepare(`
    INSERT INTO article_candidate (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      portal_url,
      source_url,
      ingestion_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    portalUrl,
    sourceUrl,
    ingestionStatus,
  );
}

function insertRelevanceSignal(db, { workspaceId, articleAnalysisId, signalType, signalValue }) {
  db.prepare(`
    INSERT INTO article_analysis_relevance_signal (
      workspace_id,
      article_analysis_id,
      signal_type,
      signal_value
    )
    VALUES (?, ?, ?, ?)
  `).run(workspaceId, articleAnalysisId, signalType, signalValue);
}

function seedWorkspaceFixture(db) {
  insertUser(db, {
    id: 'user-member',
    email: 'member@example.com',
    displayName: 'Member',
  });
  insertUser(db, {
    id: 'user-outsider',
    email: 'outsider@example.com',
    displayName: 'Outsider',
  });
  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertWorkspace(db, {
    id: 'workspace-2',
    slug: 'other-risk',
    name: 'Other Risk Desk',
  });
  insertMembership(db, {
    id: 'membership-member',
    workspaceId: 'workspace-1',
    userId: 'user-member',
  });
  insertMembership(db, {
    id: 'membership-outsider',
    workspaceId: 'workspace-2',
    userId: 'user-outsider',
  });

  insertMonitoringTarget(db, {
    id: 'target-acme',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertMonitoringTarget(db, {
    id: 'target-other',
    workspaceId: 'workspace-2',
    displayName: 'Other Holdings',
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/acme-fine',
    canonicalUrl: 'https://www.example.com/acme-fine',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme faces bribery investigation',
    authorName: 'Reporter One',
    publisherName: 'Financial Post',
    publishedAt: '2026-03-30T09:00:00.000Z',
    fetchedAt: '2026-03-30T09:02:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-1',
    topicLabels: '["governance","legal"]',
    summary: 'Authorities are investigating alleged bribery tied to Acme subsidiaries.',
    riskScore: 91,
    riskBand: 'high',
    rationale: 'Bribery investigation raises major governance risk.',
    relevanceScoredAt: '2026-03-30T09:03:00.000Z',
    topicsClassifiedAt: '2026-03-30T09:03:30.000Z',
    summaryGeneratedAt: '2026-03-30T09:04:00.000Z',
    riskScoredAt: '2026-03-30T09:05:00.000Z',
    createdAt: '2026-03-30T09:03:00.000Z',
    updatedAt: '2026-03-30T09:05:00.000Z',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-1',
    portalUrl: 'https://search.naver.com/article-1',
    sourceUrl: 'https://source.example.com/acme-fine',
  });
  insertArticleCandidate(db, {
    id: 'candidate-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-1',
    portalUrl: 'https://news.google.com/article-1',
    sourceUrl: 'https://source.example.com/acme-fine',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'Acme Holdings',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'bribery investigation',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-1',
    signalType: entityArticleAnalysisRelevanceSignalType,
    signalValue: 'Acme subsidiaries',
  });

  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-2',
    sourceUrl: 'https://source.example.com/other-story',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-2',
    title: 'Other Holdings faces routine filing issue',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-2',
    monitoringTargetId: 'target-other',
    articleId: 'article-2',
  });
}

test('getArticleDetail returns one article with summary, rationale, signals, and source links', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const articleDetail = getArticleDetail({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    articleAnalysisId: 'analysis-1',
  });

  assert.deepEqual(articleDetail, {
    articleAnalysisId: 'analysis-1',
    articleId: 'article-1',
    monitoringTargetId: 'target-acme',
    targetName: 'Acme Holdings',
    title: 'Acme faces bribery investigation',
    summary: 'Authorities are investigating alleged bribery tied to Acme subsidiaries.',
    rationale: 'Bribery investigation raises major governance risk.',
    relevanceScore: 0.9,
    riskScore: 91,
    riskBand: 'high',
    topicLabels: ['governance', 'legal'],
    matchedKeywords: ['Acme Holdings', 'bribery investigation'],
    entitySignals: ['Acme subsidiaries'],
    sourceUrl: 'https://source.example.com/acme-fine',
    canonicalUrl: 'https://www.example.com/acme-fine',
    portalUrls: [
      'https://news.google.com/article-1',
      'https://search.naver.com/article-1',
    ],
    ingestionStatus: completedArticleIngestionStatus,
    publisherName: 'Financial Post',
    authorName: 'Reporter One',
    ingestionTimestamps: {
      publishedAt: '2026-03-30T09:00:00.000Z',
      fetchedAt: '2026-03-30T09:02:00.000Z',
    },
    analysisTimestamps: {
      createdAt: '2026-03-30T09:03:00.000Z',
      updatedAt: '2026-03-30T09:05:00.000Z',
      relevanceScoredAt: '2026-03-30T09:03:00.000Z',
      topicsClassifiedAt: '2026-03-30T09:03:30.000Z',
      summaryGeneratedAt: '2026-03-30T09:04:00.000Z',
      riskScoredAt: '2026-03-30T09:05:00.000Z',
    },
    modelVersion: 'gpt-5.4',
  });

  db.close();
});

test('getArticleDetail returns empty signal and portal arrays when no related records exist', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const articleDetail = getArticleDetail({
    db,
    workspaceId: 'workspace-2',
    userId: 'user-outsider',
    articleAnalysisId: 'analysis-2',
  });

  assert.deepEqual(articleDetail.matchedKeywords, []);
  assert.deepEqual(articleDetail.entitySignals, []);
  assert.deepEqual(articleDetail.portalUrls, []);

  db.close();
});

test('getArticleDetail rejects callers outside the workspace and invalid input', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  assert.throws(
    () =>
      getArticleDetail({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-outsider',
        articleAnalysisId: 'analysis-1',
      }),
    (error) =>
      error instanceof ArticleDetailQueryServiceError &&
      error.code === 'WORKSPACE_MEMBER_FORBIDDEN',
  );

  assert.throws(
    () =>
      getArticleDetail({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        articleAnalysisId: '   ',
      }),
    (error) =>
      error instanceof ArticleDetailQueryServiceError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'articleAnalysisId is required',
  );

  assert.throws(
    () =>
      getArticleDetail({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        articleAnalysisId: 'analysis-2',
      }),
    (error) =>
      error instanceof ArticleDetailQueryServiceError &&
      error.code === 'ARTICLE_DETAIL_NOT_FOUND' &&
      error.message === 'Article detail was not found for the requested workspace',
  );

  db.close();
});
