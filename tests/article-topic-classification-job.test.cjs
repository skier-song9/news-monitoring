'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  ArticleTopicClassificationJobError,
  runArticleTopicClassificationJob,
} = require('../src/backend/article-topic-classification-job.cjs');
const {
  completedArticleIngestionStatus,
  defaultArticleCandidateIngestionStatus,
  defaultArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const { activeMonitoringTargetStatus } = require('../src/db/schema/monitoring-target.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertWorkspace(db, { id, slug, name }) {
  db.prepare(`
    INSERT INTO workspace (id, slug, name)
    VALUES (?, ?, ?)
  `).run(id, slug, name);
}

function insertMonitoringTarget(
  db,
  {
    id,
    workspaceId,
    type = 'company',
    displayName,
    note = null,
    status = activeMonitoringTargetStatus,
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
    ingestionStatus = completedArticleIngestionStatus,
  },
) {
  db.prepare(`
    INSERT INTO article (
      id,
      workspace_id,
      source_url,
      canonical_url,
      ingestion_status
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, sourceUrl, canonicalUrl, ingestionStatus);
}

function insertArticleContent(
  db,
  {
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName = null,
    publisherName = null,
    publishedAt = null,
    viewCount = null,
    fetchedAt = '2026-03-30T16:45:00.000Z',
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
      view_count,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName,
    publisherName,
    publishedAt,
    viewCount,
    fetchedAt,
  );
}

function insertArticleCandidate(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId = null,
    portalUrl,
    sourceUrl = null,
    ingestionStatus = defaultArticleCandidateIngestionStatus,
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

function insertArticleAnalysis(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    relevanceScore = null,
    topicLabels = '[]',
    summary = null,
    riskScore = null,
    riskBand = null,
    rationale = null,
    modelVersion = null,
    relevanceScoredAt = null,
    topicsClassifiedAt = null,
    summaryGeneratedAt = null,
    riskScoredAt = null,
    createdAt = '2026-03-30T12:00:00.000Z',
    updatedAt = '2026-03-30T12:00:00.000Z',
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

function insertTopicLabel(
  db,
  { workspaceId, articleAnalysisId, topicLabel, createdAt = '2026-03-30T12:00:00.000Z' },
) {
  db.prepare(`
    INSERT INTO article_analysis_topic_label (
      workspace_id,
      article_analysis_id,
      topic_label,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceId, articleAnalysisId, topicLabel, createdAt, createdAt);
}

function createIdGenerator(...ids) {
  let currentIndex = 0;

  return () => {
    const id = ids[currentIndex];

    if (!id) {
      throw new Error('No deterministic id available for test');
    }

    currentIndex += 1;
    return id;
  };
}

function normalizeRow(row) {
  return row ? { ...row } : row;
}

test('runArticleTopicClassificationJob classifies completed articles and stores topic labels once per target article', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    note: 'Watch for governance and labor issues.',
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
    canonicalUrl: 'https://source.example.com/canonical-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces labor dispute',
    bodyText: 'Acme Holdings faces a labor dispute after governance concerns escalated.',
    authorName: 'Jane Reporter',
    publisherName: 'Acme Daily',
    publishedAt: '2026-03-30T16:30:00.000Z',
    viewCount: 1200,
  });
  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-2',
    canonicalUrl: 'https://source.example.com/canonical-2',
    ingestionStatus: defaultArticleIngestionStatus,
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Pending article',
    bodyText: 'This article should not be classified yet.',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    portalUrl: 'https://news.naver.com/article/1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1-duplicate',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    portalUrl: 'https://news.google.com/article/1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleCandidate(db, {
    id: 'candidate-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    portalUrl: 'https://news.naver.com/article/2',
    sourceUrl: 'https://source.example.com/article-2',
  });

  const classificationCalls = [];
  const result = await runArticleTopicClassificationJob({
    db,
    now: () => '2026-03-30T17:00:00.000Z',
    createId: createIdGenerator('analysis-1'),
    classifyArticleTopics: async ({ monitoringTarget, article }) => {
      classificationCalls.push({ monitoringTarget, article });

      return {
        topicLabels: [' Governance ', 'governance', 'labor'],
      };
    },
  });

  const savedAnalysis = db
    .prepare(`
      SELECT id, relevance_score, topic_labels, summary, risk_score, rationale, model_version, topics_classified_at, updated_at
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get('workspace-1', 'target-1', 'article-1');
  const savedTopicLabels = db
    .prepare(`
      SELECT topic_label
      FROM article_analysis_topic_label
      WHERE workspace_id = ? AND article_analysis_id = ?
      ORDER BY topic_label
    `)
    .all('workspace-1', 'analysis-1')
    .map((row) => ({ ...row }));
  const pendingArticleAnalysis = db
    .prepare(`
      SELECT id
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get('workspace-1', 'target-1', 'article-2');

  assert.equal(classificationCalls.length, 1);
  assert.deepEqual(classificationCalls[0], {
    monitoringTarget: {
      id: 'target-1',
      workspaceId: 'workspace-1',
      type: 'company',
      displayName: 'Acme Holdings',
      note: 'Watch for governance and labor issues.',
      status: activeMonitoringTargetStatus,
      defaultRiskThreshold: 70,
    },
    article: {
      id: 'article-1',
      workspaceId: 'workspace-1',
      sourceUrl: 'https://source.example.com/article-1',
      canonicalUrl: 'https://source.example.com/canonical-1',
      ingestionStatus: completedArticleIngestionStatus,
      title: 'Acme Holdings faces labor dispute',
      bodyText: 'Acme Holdings faces a labor dispute after governance concerns escalated.',
      authorName: 'Jane Reporter',
      publisherName: 'Acme Daily',
      publishedAt: '2026-03-30T16:30:00.000Z',
      viewCount: 1200,
      fetchedAt: '2026-03-30T16:45:00.000Z',
    },
  });
  assert.deepEqual(normalizeRow(savedAnalysis), {
    id: 'analysis-1',
    relevance_score: null,
    topic_labels: '["Governance","labor"]',
    summary: null,
    risk_score: null,
    rationale: null,
    model_version: null,
    topics_classified_at: '2026-03-30T17:00:00.000Z',
    updated_at: '2026-03-30T17:00:00.000Z',
  });
  assert.deepEqual(savedTopicLabels, [
    {
      topic_label: 'Governance',
    },
    {
      topic_label: 'labor',
    },
  ]);
  assert.equal(pendingArticleAnalysis, undefined);
  assert.deepEqual(result, {
    processedAnalyses: [
      {
        analysisId: 'analysis-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        topicLabels: ['Governance', 'labor'],
        topicsClassifiedAt: '2026-03-30T17:00:00.000Z',
      },
    ],
    totalProcessed: 1,
    classifiedAnalyses: 1,
  });

  db.close();
});

test('runArticleTopicClassificationJob updates existing analysis rows without clobbering other analysis fields', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
    canonicalUrl: 'https://source.example.com/canonical-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces a governance probe',
    bodyText: 'Acme Holdings is under scrutiny after labor complaints and a governance probe.',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    portalUrl: 'https://news.naver.com/article/1',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-existing',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    relevanceScore: 0.25,
    topicLabels: '["governance"]',
    summary: 'Existing summary.',
    riskScore: 72,
    riskBand: 'high',
    rationale: 'Keep existing rationale.',
    modelVersion: 'legacy-model',
    relevanceScoredAt: '2026-03-30T12:05:00.000Z',
    topicsClassifiedAt: '2026-03-30T12:10:00.000Z',
    summaryGeneratedAt: '2026-03-30T12:15:00.000Z',
    riskScoredAt: '2026-03-30T12:20:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-existing',
    topicLabel: 'governance',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-existing',
    topicLabel: 'old topic',
  });

  const result = await runArticleTopicClassificationJob({
    db,
    now: () => '2026-03-30T17:30:00.000Z',
    createId: () => {
      throw new Error('createId should not be called when analysis already exists');
    },
    classifyArticleTopics: async () => ({
      topicLabels: ['Labor', 'legal', 'labor'],
    }),
  });

  const savedAnalysis = db
    .prepare(`
      SELECT id, relevance_score, topic_labels, summary, risk_score, risk_band, rationale, model_version, relevance_scored_at, topics_classified_at, summary_generated_at, risk_scored_at, updated_at
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get('workspace-1', 'target-1', 'article-1');
  const savedTopicLabels = db
    .prepare(`
      SELECT topic_label
      FROM article_analysis_topic_label
      WHERE workspace_id = ? AND article_analysis_id = ?
      ORDER BY topic_label
    `)
    .all('workspace-1', 'analysis-existing')
    .map((row) => ({ ...row }));

  assert.deepEqual(normalizeRow(savedAnalysis), {
    id: 'analysis-existing',
    relevance_score: 0.25,
    topic_labels: '["Labor","legal"]',
    summary: 'Existing summary.',
    risk_score: 72,
    risk_band: 'high',
    rationale: 'Keep existing rationale.',
    model_version: 'legacy-model',
    relevance_scored_at: '2026-03-30T12:05:00.000Z',
    topics_classified_at: '2026-03-30T17:30:00.000Z',
    summary_generated_at: '2026-03-30T12:15:00.000Z',
    risk_scored_at: '2026-03-30T12:20:00.000Z',
    updated_at: '2026-03-30T17:30:00.000Z',
  });
  assert.deepEqual(savedTopicLabels, [
    {
      topic_label: 'Labor',
    },
    {
      topic_label: 'legal',
    },
  ]);
  assert.deepEqual(result, {
    processedAnalyses: [
      {
        analysisId: 'analysis-existing',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        topicLabels: ['Labor', 'legal'],
        topicsClassifiedAt: '2026-03-30T17:30:00.000Z',
      },
    ],
    totalProcessed: 1,
    classifiedAnalyses: 1,
  });

  db.close();
});

test('runArticleTopicClassificationJob validates classifier output', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings mention',
    bodyText: 'Acme Holdings appears once.',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    portalUrl: 'https://news.naver.com/article/1',
  });

  await assert.rejects(
    () =>
      runArticleTopicClassificationJob({
        db,
        classifyArticleTopics: async () => ({
          topicLabels: [],
        }),
      }),
    (error) =>
      error instanceof ArticleTopicClassificationJobError &&
      error.code === 'INVALID_INPUT' &&
      /topicLabels must contain at least one label/u.test(error.message),
  );

  db.close();
});
