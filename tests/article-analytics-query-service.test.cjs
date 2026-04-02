'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  ArticleAnalyticsQueryServiceError,
  getArticleAnalyticsAggregates,
  getArticleAnalyticsDashboardPage,
} = require('../src/backend/article-analytics-query-service.cjs');
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
  insertMonitoringTarget(db, {
    id: 'target-other',
    workspaceId: 'workspace-2',
    displayName: 'Other Holdings',
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-bribery',
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
    sourceUrl: 'https://example.com/acme-recall',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Acme product recall escalates',
    authorName: 'Reporter Two',
    publisherName: 'financial post',
    publishedAt: '2026-03-31T08:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-2',
    topicLabels: '["legal","operations"]',
    riskScore: 79,
    riskBand: 'high',
    rationale: 'The recall expands operational and legal exposure.',
    riskScoredAt: '2026-03-31T08:05:00.000Z',
    updatedAt: '2026-03-31T08:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-2',
    topicLabel: 'legal',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-2',
    topicLabel: 'operations',
  });

  insertArticle(db, {
    id: 'article-3',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/jane-doe-statement',
  });
  insertArticleContent(db, {
    articleId: 'article-3',
    workspaceId: 'workspace-1',
    title: 'Jane Doe responds to governance criticism',
    authorName: 'Reporter One',
    publisherName: 'Daily Ledger',
    publishedAt: '2026-03-31T06:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-3',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-ceo',
    articleId: 'article-3',
    topicLabels: '["people"]',
    riskScore: 88,
    riskBand: 'high',
    rationale: 'The statement keeps the executive tied to an active controversy.',
    riskScoredAt: '2026-03-31T06:05:00.000Z',
    updatedAt: '2026-03-31T06:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-3',
    topicLabel: 'people',
  });

  insertArticle(db, {
    id: 'article-4',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-neutral',
  });
  insertArticleContent(db, {
    articleId: 'article-4',
    workspaceId: 'workspace-1',
    title: 'Acme reports routine quarterly update',
    authorName: 'Reporter Four',
    publisherName: 'Metro News',
    publishedAt: '2026-03-31T05:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-4',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-4',
    topicLabels: '["operations"]',
    riskScore: 65,
    riskBand: 'medium',
    rationale: 'Routine update does not cross the high-risk threshold.',
    riskScoredAt: '2026-03-31T05:05:00.000Z',
    updatedAt: '2026-03-31T05:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-4',
    topicLabel: 'operations',
  });

  insertArticle(db, {
    id: 'article-5',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-rumor',
  });
  insertArticleContent(db, {
    articleId: 'article-5',
    workspaceId: 'workspace-1',
    title: 'Acme rumor spreads online',
    authorName: 'Reporter Five',
    publisherName: 'Breaking Wire',
    publishedAt: null,
  });
  insertArticleAnalysis(db, {
    id: 'analysis-5',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-acme',
    articleId: 'article-5',
    topicLabels: '["governance"]',
    riskScore: 95,
    riskBand: 'high',
    rationale: 'Unverified rumors create immediate reputational risk.',
    riskScoredAt: '2026-03-31T04:05:00.000Z',
    updatedAt: '2026-03-31T04:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-5',
    topicLabel: 'governance',
  });

  insertArticle(db, {
    id: 'article-6',
    workspaceId: 'workspace-2',
    sourceUrl: 'https://example.com/other-story',
  });
  insertArticleContent(db, {
    articleId: 'article-6',
    workspaceId: 'workspace-2',
    title: 'Other Holdings faces lawsuit',
    authorName: 'Reporter Six',
    publisherName: 'Outside Journal',
    publishedAt: '2026-03-31T07:00:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-6',
    workspaceId: 'workspace-2',
    monitoringTargetId: 'target-other',
    articleId: 'article-6',
    topicLabels: '["legal"]',
    riskScore: 90,
    riskBand: 'high',
    rationale: 'Separate workspace data should not leak into analytics.',
    riskScoredAt: '2026-03-31T07:05:00.000Z',
    updatedAt: '2026-03-31T07:05:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-2',
    articleAnalysisId: 'analysis-6',
    topicLabel: 'legal',
  });
}

test('getArticleAnalyticsAggregates returns high-risk topic, publisher, and reporter summaries with drilldown ids', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const analytics = getArticleAnalyticsAggregates({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    publishedFrom: '2026-03-30T00:00:00.000Z',
    publishedTo: '2026-03-31T23:59:59.000Z',
  });

  assert.deepEqual(analytics, {
    topicSummaries: [
      {
        topicLabel: 'legal',
        highRiskArticleCount: 2,
        articleIds: ['article-1', 'article-2'],
        articleAnalysisIds: ['analysis-1', 'analysis-2'],
      },
      {
        topicLabel: 'governance',
        highRiskArticleCount: 1,
        articleIds: ['article-1'],
        articleAnalysisIds: ['analysis-1'],
      },
      {
        topicLabel: 'operations',
        highRiskArticleCount: 1,
        articleIds: ['article-2'],
        articleAnalysisIds: ['analysis-2'],
      },
      {
        topicLabel: 'people',
        highRiskArticleCount: 1,
        articleIds: ['article-3'],
        articleAnalysisIds: ['analysis-3'],
      },
    ],
    publisherSummaries: [
      {
        publisherName: 'Financial Post',
        highRiskArticleCount: 2,
        articleIds: ['article-1', 'article-2'],
        articleAnalysisIds: ['analysis-1', 'analysis-2'],
      },
      {
        publisherName: 'Daily Ledger',
        highRiskArticleCount: 1,
        articleIds: ['article-3'],
        articleAnalysisIds: ['analysis-3'],
      },
    ],
    reporterSummaries: [
      {
        reporterName: 'Reporter One',
        highRiskArticleCount: 2,
        articleIds: ['article-1', 'article-3'],
        articleAnalysisIds: ['analysis-1', 'analysis-3'],
      },
      {
        reporterName: 'Reporter Two',
        highRiskArticleCount: 1,
        articleIds: ['article-2'],
        articleAnalysisIds: ['analysis-2'],
      },
    ],
  });

  db.close();
});

test('getArticleAnalyticsAggregates supports optional monitoring target filters', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const analytics = getArticleAnalyticsAggregates({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    monitoringTargetId: 'target-acme',
    publishedFrom: '2026-03-30T00:00:00.000Z',
    publishedTo: '2026-03-31T23:59:59.000Z',
  });

  assert.deepEqual(analytics, {
    topicSummaries: [
      {
        topicLabel: 'legal',
        highRiskArticleCount: 2,
        articleIds: ['article-1', 'article-2'],
        articleAnalysisIds: ['analysis-1', 'analysis-2'],
      },
      {
        topicLabel: 'governance',
        highRiskArticleCount: 1,
        articleIds: ['article-1'],
        articleAnalysisIds: ['analysis-1'],
      },
      {
        topicLabel: 'operations',
        highRiskArticleCount: 1,
        articleIds: ['article-2'],
        articleAnalysisIds: ['analysis-2'],
      },
    ],
    publisherSummaries: [
      {
        publisherName: 'Financial Post',
        highRiskArticleCount: 2,
        articleIds: ['article-1', 'article-2'],
        articleAnalysisIds: ['analysis-1', 'analysis-2'],
      },
    ],
    reporterSummaries: [
      {
        reporterName: 'Reporter One',
        highRiskArticleCount: 1,
        articleIds: ['article-1'],
        articleAnalysisIds: ['analysis-1'],
      },
      {
        reporterName: 'Reporter Two',
        highRiskArticleCount: 1,
        articleIds: ['article-2'],
        articleAnalysisIds: ['analysis-2'],
      },
    ],
  });

  db.close();
});

test('getArticleAnalyticsAggregates rejects callers outside the workspace and invalid date filters', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  assert.throws(
    () =>
      getArticleAnalyticsAggregates({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-outsider',
      }),
    (error) =>
      error instanceof ArticleAnalyticsQueryServiceError &&
      error.code === 'WORKSPACE_MEMBER_FORBIDDEN',
  );

  assert.throws(
    () =>
      getArticleAnalyticsAggregates({
        db,
        workspaceId: 'workspace-1',
        userId: 'user-member',
        publishedFrom: '2026-04-01T00:00:00.000Z',
        publishedTo: '2026-03-31T00:00:00.000Z',
      }),
    (error) =>
      error instanceof ArticleAnalyticsQueryServiceError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'publishedFrom must be earlier than or equal to publishedTo',
  );

  db.close();
});

test('getArticleAnalyticsDashboardPage returns workspace context, filter state, and date-only analytics summaries', () => {
  const db = createDatabase();
  seedWorkspaceFixture(db);

  const analyticsPage = getArticleAnalyticsDashboardPage({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-member',
    monitoringTargetId: 'target-acme',
    publishedFrom: '2026-03-30',
    publishedTo: '2026-03-31',
  });

  assert.deepEqual(analyticsPage.workspace, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  assert.equal(analyticsPage.viewer.userId, 'user-member');
  assert.equal(analyticsPage.filters.values.monitoringTargetId, 'target-acme');
  assert.equal(analyticsPage.filters.values.publishedFrom, '2026-03-30');
  assert.equal(analyticsPage.filters.values.publishedTo, '2026-03-31');
  assert.deepEqual(
    analyticsPage.filters.options.monitoringTargets.map((target) => target.id),
    ['target-acme', 'target-ceo'],
  );
  assert.deepEqual(analyticsPage.analytics.topicSummaries, [
    {
      topicLabel: 'legal',
      highRiskArticleCount: 2,
      articleIds: ['article-1', 'article-2'],
      articleAnalysisIds: ['analysis-1', 'analysis-2'],
    },
    {
      topicLabel: 'governance',
      highRiskArticleCount: 1,
      articleIds: ['article-1'],
      articleAnalysisIds: ['analysis-1'],
    },
    {
      topicLabel: 'operations',
      highRiskArticleCount: 1,
      articleIds: ['article-2'],
      articleAnalysisIds: ['analysis-2'],
    },
  ]);

  db.close();
});
