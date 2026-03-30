'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  ArticleFeedQueryServiceError,
  listArticleFeed,
} = require('../src/backend/article-feed-query-service.cjs');
const { completedArticleIngestionStatus } = require('../src/db/schema/article-ingestion.cjs');

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

function insertTopicLabel(db, { workspaceId, articleAnalysisId, topicLabel }) {
  db.prepare(`
    INSERT INTO article_analysis_topic_label (
      workspace_id,
      article_analysis_id,
      topic_label
    )
    VALUES (?, ?, ?)
  `).run(workspaceId, articleAnalysisId, topicLabel);
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
    id: 'target-ceo',
    workspaceId: 'workspace-1',
    type: 'person',
    displayName: 'Jane Doe',
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-fine',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme faces bribery investigation',
    authorName: 'Reporter One',
    publisherName: 'Financial Post',
    publishedAt: '2026-03-30T09:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-1',
    topicLabels: '["governance","legal"]',
    riskScore: 91,
    riskBand: 'high',
    rationale: 'Bribery investigation raises major governance risk.',
    riskScoredAt: '2026-03-30T09:05:00.000Z',
    updatedAt: '2026-03-30T09:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-1',
    topicLabel: 'governance',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-1',
    topicLabel: 'legal',
  });

  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-product-recall',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Acme recalls flagship product',
    authorName: 'Reporter Two',
    publisherName: 'Daily Ledger',
    publishedAt: '2026-03-31T07:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-2',
    topicLabels: '["operations"]',
    riskScore: 64,
    riskBand: 'medium',
    rationale: 'Recall may damage operations and customer trust.',
    riskScoredAt: '2026-03-31T07:05:00.000Z',
    updatedAt: '2026-03-31T07:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-2',
    topicLabel: 'operations',
  });

  insertArticle(db, {
    id: 'article-3',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/jane-doe-speech',
  });
  insertArticleContent(db, {
    articleId: 'article-3',
    workspaceId: 'workspace-1',
    title: 'Jane Doe outlines new hiring plan',
    authorName: 'Reporter Three',
    publisherName: 'financial post',
    publishedAt: '2026-03-29T12:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-3',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-ceo',
    articleId: 'article-3',
    topicLabels: '["people"]',
    riskScore: 22,
    riskBand: 'low',
    rationale: 'Routine leadership update with low downside risk.',
    riskScoredAt: '2026-03-29T12:05:00.000Z',
    updatedAt: '2026-03-29T12:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-3',
    topicLabel: 'people',
  });

  insertArticle(db, {
    id: 'article-4',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-coverage',
  });
  insertArticleContent(db, {
    articleId: 'article-4',
    workspaceId: 'workspace-1',
    title: 'Acme receives broad neutral coverage',
    authorName: 'Reporter Four',
    publisherName: 'Metro News',
    publishedAt: null,
  });
  insertArticleAnalysis(db, {
    id: 'analysis-4',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-4',
    topicLabels: '[]',
    riskScore: null,
    riskBand: null,
    rationale: null,
    riskScoredAt: null,
    updatedAt: '2026-03-31T06:00:00.000Z',
  });
}

test('listArticleFeed returns highest-risk articles first by default with the dashboard fields', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const articles = listArticleFeed({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
  });

  assert.deepEqual(articles, [
    {
      articleAnalysisId: 'analysis-1',
      articleId: 'article-1',
      monitoringTargetId: 'target-acme',
      targetName: 'Acme Holdings',
      title: 'Acme faces bribery investigation',
      riskScore: 91,
      riskBand: 'high',
      topicLabels: ['governance', 'legal'],
      publisherName: 'Financial Post',
      authorName: 'Reporter One',
      publishedAt: '2026-03-30T09:00:00.000Z',
    },
    {
      articleAnalysisId: 'analysis-2',
      articleId: 'article-2',
      monitoringTargetId: 'target-acme',
      targetName: 'Acme Holdings',
      title: 'Acme recalls flagship product',
      riskScore: 64,
      riskBand: 'medium',
      topicLabels: ['operations'],
      publisherName: 'Daily Ledger',
      authorName: 'Reporter Two',
      publishedAt: '2026-03-31T07:00:00.000Z',
    },
    {
      articleAnalysisId: 'analysis-3',
      articleId: 'article-3',
      monitoringTargetId: 'target-ceo',
      targetName: 'Jane Doe',
      title: 'Jane Doe outlines new hiring plan',
      riskScore: 22,
      riskBand: 'low',
      topicLabels: ['people'],
      publisherName: 'financial post',
      authorName: 'Reporter Three',
      publishedAt: '2026-03-29T12:00:00.000Z',
    },
    {
      articleAnalysisId: 'analysis-4',
      articleId: 'article-4',
      monitoringTargetId: 'target-acme',
      targetName: 'Acme Holdings',
      title: 'Acme receives broad neutral coverage',
      riskScore: null,
      riskBand: null,
      topicLabels: [],
      publisherName: 'Metro News',
      authorName: 'Reporter Four',
      publishedAt: null,
    },
  ]);

  db.close();
});

test('listArticleFeed supports target, risk band, topic, publisher, and date-range filters', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const filteredArticles = listArticleFeed({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    monitoringTargetId: 'target-acme',
    riskBand: 'high',
    topicLabel: 'governance',
    publisher: ' financial post ',
    publishedFrom: '2026-03-30T00:00:00.000Z',
    publishedTo: '2026-03-30T23:59:59.000Z',
  });

  assert.deepEqual(filteredArticles, [
    {
      articleAnalysisId: 'analysis-1',
      articleId: 'article-1',
      monitoringTargetId: 'target-acme',
      targetName: 'Acme Holdings',
      title: 'Acme faces bribery investigation',
      riskScore: 91,
      riskBand: 'high',
      topicLabels: ['governance', 'legal'],
      publisherName: 'Financial Post',
      authorName: 'Reporter One',
      publishedAt: '2026-03-30T09:00:00.000Z',
    },
  ]);

  db.close();
});

test('listArticleFeed supports explicit sort filters', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const newestFirstArticles = listArticleFeed({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    sort: 'newest',
  });

  assert.deepEqual(
    newestFirstArticles.map((article) => article.articleAnalysisId),
    ['analysis-2', 'analysis-1', 'analysis-3', 'analysis-4'],
  );

  db.close();
});

test('listArticleFeed rejects callers outside the workspace and invalid filter input', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  assert.throws(
    () =>
      listArticleFeed({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-outsider',
      }),
    (error) =>
      error instanceof ArticleFeedQueryServiceError &&
      error.code === 'WORKSPACE_MEMBER_FORBIDDEN',
  );

  assert.throws(
    () =>
      listArticleFeed({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        sort: 'priority',
      }),
    (error) =>
      error instanceof ArticleFeedQueryServiceError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'sort must be one of: highest_risk, lowest_risk, newest, oldest',
  );

  assert.throws(
    () =>
      listArticleFeed({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        publishedFrom: '2026-03-31T00:00:00.000Z',
        publishedTo: '2026-03-30T00:00:00.000Z',
      }),
    (error) =>
      error instanceof ArticleFeedQueryServiceError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'publishedFrom must be earlier than or equal to publishedTo',
  );

  db.close();
});
