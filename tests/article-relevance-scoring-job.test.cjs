'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  ArticleRelevanceScoringJobError,
  runArticleRelevanceScoringJob,
} = require('../src/backend/article-relevance-scoring-job.cjs');
const {
  completedArticleIngestionStatus,
  defaultArticleCandidateIngestionStatus,
  defaultArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const { activeMonitoringTargetStatus } = require('../src/db/schema/monitoring-target.cjs');
const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../src/db/schema/analysis-alert.cjs');
const {
  excludedTargetKeywordSourceType,
  expandedTargetKeywordSourceType,
  seedTargetKeywordSourceType,
} = require('../src/db/schema/target-keyword.cjs');

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

function insertKeyword(
  db,
  {
    id,
    monitoringTargetId,
    keyword,
    sourceType = seedTargetKeywordSourceType,
    isActive = 1,
    displayOrder = 0,
  },
) {
  db.prepare(`
    INSERT INTO target_keyword (
      id,
      monitoring_target_id,
      keyword,
      source_type,
      is_active,
      display_order
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, monitoringTargetId, keyword, sourceType, isActive, displayOrder);
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
    fetchedAt = '2026-03-30T14:45:00.000Z',
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

function insertRelevanceSignal(
  db,
  { workspaceId, articleAnalysisId, signalType, signalValue, createdAt = '2026-03-30T12:00:00.000Z' },
) {
  db.prepare(`
    INSERT INTO article_analysis_relevance_signal (
      workspace_id,
      article_analysis_id,
      signal_type,
      signal_value,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, articleAnalysisId, signalType, signalValue, createdAt, createdAt);
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

test('runArticleRelevanceScoringJob scores completed articles and stores relevance signals once per target article', async () => {
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
    note: 'Watch for supplier and governance issues.',
  });
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'expanded-1',
    monitoringTargetId: 'target-1',
    keyword: 'supplier complaint',
    sourceType: expandedTargetKeywordSourceType,
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'excluded-1',
    monitoringTargetId: 'target-1',
    keyword: 'fan cam',
    sourceType: excludedTargetKeywordSourceType,
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'expanded-disabled',
    monitoringTargetId: 'target-1',
    keyword: 'ignored keyword',
    sourceType: expandedTargetKeywordSourceType,
    isActive: 0,
    displayOrder: 1,
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
    title: 'Acme Holdings faces supplier complaint',
    bodyText: 'Acme Holdings and its chief executive are mentioned in a supplier complaint.',
    authorName: 'Jane Reporter',
    publisherName: 'Acme Daily',
    publishedAt: '2026-03-30T14:30:00.000Z',
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
    bodyText: 'This article should not be scored yet.',
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

  const scoreCalls = [];
  const result = await runArticleRelevanceScoringJob({
    db,
    now: () => '2026-03-30T15:00:00.000Z',
    createId: createIdGenerator('analysis-1'),
    scoreArticleRelevance: async ({ monitoringTarget, article, collectorInput }) => {
      scoreCalls.push({ monitoringTarget, article, collectorInput });

      return {
        relevanceScore: 0.92,
        matchedKeywords: [' Acme Holdings ', 'acme holdings', 'supplier complaint'],
        entitySignals: ['Jane Reporter', 'jane reporter'],
        modelVersion: 'gpt-5.4-mini',
      };
    },
  });

  const savedAnalysis = db
    .prepare(`
      SELECT id, relevance_score, topic_labels, summary, risk_score, rationale, model_version, relevance_scored_at, updated_at
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get('workspace-1', 'target-1', 'article-1');
  const savedSignals = db
    .prepare(`
      SELECT signal_type, signal_value
      FROM article_analysis_relevance_signal
      WHERE workspace_id = ? AND article_analysis_id = ?
      ORDER BY signal_type, signal_value
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

  assert.equal(scoreCalls.length, 1);
  assert.deepEqual(scoreCalls[0], {
    monitoringTarget: {
      id: 'target-1',
      workspaceId: 'workspace-1',
      type: 'company',
      displayName: 'Acme Holdings',
      note: 'Watch for supplier and governance issues.',
      status: activeMonitoringTargetStatus,
      defaultRiskThreshold: 70,
    },
    article: {
      id: 'article-1',
      workspaceId: 'workspace-1',
      sourceUrl: 'https://source.example.com/article-1',
      canonicalUrl: 'https://source.example.com/canonical-1',
      ingestionStatus: completedArticleIngestionStatus,
      title: 'Acme Holdings faces supplier complaint',
      bodyText: 'Acme Holdings and its chief executive are mentioned in a supplier complaint.',
      authorName: 'Jane Reporter',
      publisherName: 'Acme Daily',
      publishedAt: '2026-03-30T14:30:00.000Z',
      viewCount: 1200,
      fetchedAt: '2026-03-30T14:45:00.000Z',
    },
    collectorInput: {
      workspaceId: 'workspace-1',
      monitoringTargetId: 'target-1',
      seedKeywords: [
        {
          id: 'seed-1',
          keyword: 'Acme Holdings',
          sourceType: seedTargetKeywordSourceType,
          isActive: 1,
          displayOrder: 0,
        },
      ],
      expandedKeywords: [
        {
          id: 'expanded-1',
          keyword: 'supplier complaint',
          sourceType: expandedTargetKeywordSourceType,
          isActive: 1,
          displayOrder: 0,
        },
      ],
      excludedKeywords: [
        {
          id: 'excluded-1',
          keyword: 'fan cam',
          sourceType: excludedTargetKeywordSourceType,
          isActive: 1,
          displayOrder: 0,
        },
      ],
    },
  });
  assert.deepEqual(normalizeRow(savedAnalysis), {
    id: 'analysis-1',
    relevance_score: 0.92,
    topic_labels: '[]',
    summary: null,
    risk_score: null,
    rationale: null,
    model_version: 'gpt-5.4-mini',
    relevance_scored_at: '2026-03-30T15:00:00.000Z',
    updated_at: '2026-03-30T15:00:00.000Z',
  });
  assert.deepEqual(savedSignals, [
    {
      signal_type: entityArticleAnalysisRelevanceSignalType,
      signal_value: 'Jane Reporter',
    },
    {
      signal_type: keywordArticleAnalysisRelevanceSignalType,
      signal_value: 'Acme Holdings',
    },
    {
      signal_type: keywordArticleAnalysisRelevanceSignalType,
      signal_value: 'supplier complaint',
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
        relevanceScore: 0.92,
        matchedKeywords: ['Acme Holdings', 'supplier complaint'],
        entitySignals: ['Jane Reporter'],
        modelVersion: 'gpt-5.4-mini',
        relevanceScoredAt: '2026-03-30T15:00:00.000Z',
      },
    ],
    totalProcessed: 1,
    scoredAnalyses: 1,
  });

  db.close();
});

test('runArticleRelevanceScoringJob updates existing analysis rows without clobbering other analysis fields', async () => {
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
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
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
    bodyText: 'Acme Holdings is under scrutiny.',
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
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-existing',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'Old keyword',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-existing',
    signalType: entityArticleAnalysisRelevanceSignalType,
    signalValue: 'Old entity',
  });

  const result = await runArticleRelevanceScoringJob({
    db,
    now: () => '2026-03-30T15:30:00.000Z',
    createId: () => {
      throw new Error('createId should not be called when analysis already exists');
    },
    scoreArticleRelevance: async () => ({
      relevanceScore: 0.81,
      matchedKeywords: ['Acme Holdings'],
      entitySignals: ['Acme executive'],
      modelVersion: 'gpt-5.4',
    }),
  });

  const savedAnalysis = db
    .prepare(`
      SELECT id, relevance_score, topic_labels, summary, risk_score, risk_band, rationale, model_version, relevance_scored_at, topics_classified_at, summary_generated_at, risk_scored_at, updated_at
      FROM article_analysis
      WHERE workspace_id = ? AND monitoring_target_id = ? AND article_id = ?
    `)
    .get('workspace-1', 'target-1', 'article-1');
  const savedSignals = db
    .prepare(`
      SELECT signal_type, signal_value
      FROM article_analysis_relevance_signal
      WHERE workspace_id = ? AND article_analysis_id = ?
      ORDER BY signal_type, signal_value
    `)
    .all('workspace-1', 'analysis-existing')
    .map((row) => ({ ...row }));

  assert.deepEqual(normalizeRow(savedAnalysis), {
    id: 'analysis-existing',
    relevance_score: 0.81,
    topic_labels: '["governance"]',
    summary: 'Existing summary.',
    risk_score: 72,
    risk_band: 'high',
    rationale: 'Keep existing rationale.',
    model_version: 'gpt-5.4',
    relevance_scored_at: '2026-03-30T15:30:00.000Z',
    topics_classified_at: '2026-03-30T12:10:00.000Z',
    summary_generated_at: '2026-03-30T12:15:00.000Z',
    risk_scored_at: '2026-03-30T12:20:00.000Z',
    updated_at: '2026-03-30T15:30:00.000Z',
  });
  assert.deepEqual(savedSignals, [
    {
      signal_type: entityArticleAnalysisRelevanceSignalType,
      signal_value: 'Acme executive',
    },
    {
      signal_type: keywordArticleAnalysisRelevanceSignalType,
      signal_value: 'Acme Holdings',
    },
  ]);
  assert.deepEqual(result, {
    processedAnalyses: [
      {
        analysisId: 'analysis-existing',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        relevanceScore: 0.81,
        matchedKeywords: ['Acme Holdings'],
        entitySignals: ['Acme executive'],
        modelVersion: 'gpt-5.4',
        relevanceScoredAt: '2026-03-30T15:30:00.000Z',
      },
    ],
    totalProcessed: 1,
    scoredAnalyses: 1,
  });

  db.close();
});

test('runArticleRelevanceScoringJob validates scorer output', async () => {
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
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
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
      runArticleRelevanceScoringJob({
        db,
        scoreArticleRelevance: async () => ({
          relevanceScore: 1.5,
        }),
      }),
    (error) =>
      error instanceof ArticleRelevanceScoringJobError &&
      error.code === 'INVALID_INPUT' &&
      /relevanceScore must be a finite number between 0 and 1/u.test(error.message),
  );

  db.close();
});
