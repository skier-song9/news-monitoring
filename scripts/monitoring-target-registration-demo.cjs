'use strict';

const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  saveTargetAlertPolicy,
  saveWorkspaceAlertPolicy,
} = require('../src/backend/alert-policy-service.cjs');
const {
  runMonitoringTargetDiscoveryJob,
} = require('../src/backend/monitoring-target-discovery-job.cjs');
const {
  createMonitoringTarget,
} = require('../src/backend/monitoring-target-service.cjs');
const { createWorkspace } = require('../src/backend/workspace-service.cjs');
const {
  completedArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../src/db/schema/analysis-alert.cjs');
const {
  createMonitoringTargetRegistrationApp,
} = require('../src/http/monitoring-target-registration-app.cjs');

function insertUser(db, { id, email, displayName }) {
  db.prepare(`
    INSERT INTO user_account (id, email, display_name)
    VALUES (?, ?, ?)
  `).run(id, email, displayName);
}

function insertMembership(db, { id, workspaceId, userId, role, status = 'active' }) {
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
    sourceUrl,
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
    bodyText = 'Demo article body',
    authorName,
    publisherName,
    publishedAt,
    fetchedAt,
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
    topicLabels,
    summary = null,
    riskScore,
    riskBand,
    rationale,
    modelVersion = 'gpt-demo-dashboard',
    relevanceScore = 0.92,
    relevanceScoredAt,
    topicsClassifiedAt,
    summaryGeneratedAt = null,
    riskScoredAt,
    createdAt,
    updatedAt,
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
    JSON.stringify(topicLabels),
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

function createIdGenerator(...ids) {
  let currentIndex = 0;

  return () => {
    const id = ids[currentIndex];

    if (!id) {
      throw new Error('No deterministic id available for demo');
    }

    currentIndex += 1;
    return id;
  };
}

function seedDemoData(db) {
  insertUser(db, {
    id: 'user-owner',
    email: 'owner@acme.example',
    displayName: 'Morgan Lee',
  });
  insertUser(db, {
    id: 'user-member',
    email: 'member@acme.example',
    displayName: 'Riley Song',
  });

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    now: () => '2026-04-02T01:00:00.000Z',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  insertMembership(db, {
    id: 'membership-member',
    workspaceId: workspace.id,
    userId: 'user-member',
    role: 'member',
  });

  return workspace;
}

async function seedReviewDemoTarget(db, workspaceId) {
  const target = createMonitoringTarget({
    db,
    workspaceId,
    userId: 'user-owner',
    type: 'company',
    displayName: 'Acme Holdings',
    note: 'Review this generated profile before activation.',
    defaultRiskThreshold: 83,
    seedKeywords: ['Acme Holdings', 'Acme founder'],
    now: () => '2026-04-02T02:00:00.000Z',
    createId: createIdGenerator(
      'target-review-demo-1',
      'seed-review-demo-1',
      'seed-review-demo-2',
    ),
  });

  await runMonitoringTargetDiscoveryJob({
    db,
    monitoringTargetId: target.id,
    now: () => '2026-04-02T02:15:00.000Z',
    createId: createIdGenerator(
      'profile-review-demo-1',
      'expanded-review-demo-1',
      'expanded-review-demo-2',
    ),
    searchWeb: async ({ keyword }) => [
      {
        title: `${keyword} coverage signal`,
        url: `https://news.example.com/${encodeURIComponent(keyword)}`,
        snippet: `${keyword} appears in a recent risk signal.`,
        source: 'Google News',
      },
    ],
    generateTargetProfile: async () => ({
      summary:
        'Discovery results point to Acme Holdings, founder Jane Doe, and the Acme Labs subsidiary as the main identity signals.',
      relatedEntities: ['Jane Doe', 'Acme Labs'],
      aliases: ['Acme', 'Acme Holdings'],
      expandedKeywords: ['Acme Labs', 'Jane Doe'],
      modelVersion: 'gpt-demo-1',
    }),
  });

  saveWorkspaceAlertPolicy({
    db,
    workspaceId,
    userId: 'user-owner',
    riskThreshold: 78,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/WORKSPACE',
    emailEnabled: true,
    emailRecipients: ['desk@acme.example'],
    createId: createIdGenerator('policy-workspace-demo-1'),
    now: () => '2026-04-02T02:20:00.000Z',
  });

  saveTargetAlertPolicy({
    db,
    workspaceId,
    monitoringTargetId: target.id,
    userId: 'user-owner',
    riskThreshold: 91,
    slackEnabled: false,
    slackWebhookUrl: '',
    emailEnabled: true,
    emailRecipients: ['owner@acme.example'],
    smsEnabled: true,
    smsRecipients: ['+12025550111'],
    createId: createIdGenerator('policy-target-demo-1'),
    now: () => '2026-04-02T02:25:00.000Z',
  });

  return target;
}

function seedDashboardDemoData(db, workspaceId) {
  insertMonitoringTarget(db, {
    id: 'target-dashboard-acme',
    workspaceId,
    type: 'company',
    displayName: 'Acme Holdings',
    note: 'Active dashboard coverage target.',
    status: 'active',
    defaultRiskThreshold: 83,
  });
  insertMonitoringTarget(db, {
    id: 'target-dashboard-jane',
    workspaceId,
    type: 'person',
    displayName: 'Jane Doe',
    note: 'Executive monitoring target.',
    status: 'active',
    defaultRiskThreshold: 78,
  });

  insertArticle(db, {
    id: 'article-dashboard-1',
    workspaceId,
    sourceUrl: 'https://example.com/acme-governance',
    canonicalUrl: 'https://example.com/acme-governance',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-1',
    workspaceId,
    title: 'Acme faces governance investigation after whistleblower filing',
    authorName: 'Naomi Park',
    publisherName: 'Financial Dispatch',
    publishedAt: '2026-04-02T02:45:00.000Z',
    fetchedAt: '2026-04-02T02:47:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-1',
    workspaceId,
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    topicLabels: ['governance', 'legal'],
    riskScore: 92,
    riskBand: 'high',
    rationale: 'A whistleblower-backed probe can materially escalate regulatory risk.',
    summary: 'Governance concerns intensified after the filing reached regulators.',
    relevanceScoredAt: '2026-04-02T02:48:00.000Z',
    topicsClassifiedAt: '2026-04-02T02:49:00.000Z',
    summaryGeneratedAt: '2026-04-02T02:50:00.000Z',
    riskScoredAt: '2026-04-02T02:51:00.000Z',
    createdAt: '2026-04-02T02:48:00.000Z',
    updatedAt: '2026-04-02T02:51:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-1',
    topicLabel: 'governance',
  });
  insertTopicLabel(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-1',
    topicLabel: 'legal',
  });
  insertArticleCandidate(db, {
    id: 'candidate-dashboard-1',
    workspaceId,
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    portalUrl: 'https://search.naver.com/acme-governance',
    sourceUrl: 'https://example.com/acme-governance',
  });
  insertArticleCandidate(db, {
    id: 'candidate-dashboard-2',
    workspaceId,
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    portalUrl: 'https://news.google.com/acme-governance',
    sourceUrl: 'https://example.com/acme-governance',
  });
  insertRelevanceSignal(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'Acme Holdings',
  });
  insertRelevanceSignal(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'whistleblower filing',
  });
  insertRelevanceSignal(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: entityArticleAnalysisRelevanceSignalType,
    signalValue: 'regulators',
  });

  insertArticle(db, {
    id: 'article-dashboard-2',
    workspaceId,
    sourceUrl: 'https://example.com/acme-recall',
    canonicalUrl: 'https://example.com/acme-recall',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-2',
    workspaceId,
    title: 'Acme expands recall to a second product line',
    authorName: 'Owen Choi',
    publisherName: 'Daily Ledger',
    publishedAt: '2026-04-02T01:40:00.000Z',
    fetchedAt: '2026-04-02T01:42:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-2',
    workspaceId,
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-2',
    topicLabels: ['operations'],
    riskScore: 68,
    riskBand: 'medium',
    rationale: 'Operational disruption remains material, but the issue is still bounded.',
    summary: 'The recall widened and raised questions about production oversight.',
    relevanceScoredAt: '2026-04-02T01:43:00.000Z',
    topicsClassifiedAt: '2026-04-02T01:44:00.000Z',
    summaryGeneratedAt: '2026-04-02T01:45:00.000Z',
    riskScoredAt: '2026-04-02T01:46:00.000Z',
    createdAt: '2026-04-02T01:43:00.000Z',
    updatedAt: '2026-04-02T01:46:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-2',
    topicLabel: 'operations',
  });

  insertArticle(db, {
    id: 'article-dashboard-3',
    workspaceId,
    sourceUrl: 'https://example.com/jane-doe-townhall',
    canonicalUrl: 'https://example.com/jane-doe-townhall',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-3',
    workspaceId,
    title: 'Jane Doe outlines a cautious hiring plan in town hall remarks',
    authorName: 'Mina Han',
    publisherName: 'financial dispatch',
    publishedAt: '2026-04-01T22:20:00.000Z',
    fetchedAt: '2026-04-01T22:25:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-3',
    workspaceId,
    monitoringTargetId: 'target-dashboard-jane',
    articleId: 'article-dashboard-3',
    topicLabels: ['people'],
    riskScore: 24,
    riskBand: 'low',
    rationale: 'The remarks are routine and do not indicate immediate downside.',
    summary: 'Leadership messaging stayed measured and low risk.',
    relevanceScoredAt: '2026-04-01T22:26:00.000Z',
    topicsClassifiedAt: '2026-04-01T22:27:00.000Z',
    summaryGeneratedAt: '2026-04-01T22:28:00.000Z',
    riskScoredAt: '2026-04-01T22:29:00.000Z',
    createdAt: '2026-04-01T22:26:00.000Z',
    updatedAt: '2026-04-01T22:29:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId,
    articleAnalysisId: 'analysis-dashboard-3',
    topicLabel: 'people',
  });
}

function startDashboardLiveTicker(db, workspaceId) {
  const liveArticles = [
    {
      articleId: 'article-dashboard-live-1',
      articleAnalysisId: 'analysis-dashboard-live-1',
      monitoringTargetId: 'target-dashboard-acme',
      title: 'Acme investor memo leaks ahead of the board meeting',
      authorName: 'Hana Seo',
      publisherName: 'Market Watchtower',
      publishedAt: '2026-04-02T03:02:00.000Z',
      fetchedAt: '2026-04-02T03:03:00.000Z',
      riskScore: 88,
      riskBand: 'high',
      topicLabels: ['governance', 'investors'],
      rationale: 'A board-related leak keeps governance risk elevated and newsworthy.',
      summary: 'Fresh leak coverage raises investor pressure before the board session.',
      createdAt: '2026-04-02T03:03:00.000Z',
      updatedAt: '2026-04-02T03:05:00.000Z',
    },
    {
      articleId: 'article-dashboard-live-2',
      articleAnalysisId: 'analysis-dashboard-live-2',
      monitoringTargetId: 'target-dashboard-jane',
      title: 'Jane Doe addresses executive turnover in an internal memo',
      authorName: 'Rin Kwon',
      publisherName: 'Desk Wire',
      publishedAt: '2026-04-02T03:07:00.000Z',
      fetchedAt: '2026-04-02T03:08:00.000Z',
      riskScore: 57,
      riskBand: 'medium',
      topicLabels: ['people', 'leadership'],
      rationale: 'Leadership churn is notable, but the tone remains controlled.',
      summary: 'Executive-turnover coverage moves this target into the medium-risk tier.',
      createdAt: '2026-04-02T03:08:00.000Z',
      updatedAt: '2026-04-02T03:09:00.000Z',
    },
  ];

  let currentIndex = 0;
  const timer = setInterval(() => {
    const liveArticle = liveArticles[currentIndex];

    if (!liveArticle) {
      clearInterval(timer);
      return;
    }

    insertArticle(db, {
      id: liveArticle.articleId,
      workspaceId,
      sourceUrl: `https://example.com/${liveArticle.articleId}`,
      canonicalUrl: `https://example.com/${liveArticle.articleId}`,
    });
    insertArticleContent(db, {
      articleId: liveArticle.articleId,
      workspaceId,
      title: liveArticle.title,
      authorName: liveArticle.authorName,
      publisherName: liveArticle.publisherName,
      publishedAt: liveArticle.publishedAt,
      fetchedAt: liveArticle.fetchedAt,
    });
    insertArticleAnalysis(db, {
      id: liveArticle.articleAnalysisId,
      workspaceId,
      monitoringTargetId: liveArticle.monitoringTargetId,
      articleId: liveArticle.articleId,
      topicLabels: liveArticle.topicLabels,
      riskScore: liveArticle.riskScore,
      riskBand: liveArticle.riskBand,
      rationale: liveArticle.rationale,
      summary: liveArticle.summary,
      relevanceScoredAt: liveArticle.createdAt,
      topicsClassifiedAt: liveArticle.createdAt,
      summaryGeneratedAt: liveArticle.updatedAt,
      riskScoredAt: liveArticle.updatedAt,
      createdAt: liveArticle.createdAt,
      updatedAt: liveArticle.updatedAt,
    });

    for (const topicLabel of liveArticle.topicLabels) {
      insertTopicLabel(db, {
        workspaceId,
        articleAnalysisId: liveArticle.articleAnalysisId,
        topicLabel,
      });
    }

    currentIndex += 1;
  }, 4500);

  return timer;
}

const port = Number.parseInt(process.env.PORT ?? '4311', 10);
const db = new DatabaseSync(':memory:');
applyMigrations(db);
const workspace = seedDemoData(db);
seedDashboardDemoData(db, workspace.id);

const server = createServer(
  createMonitoringTargetRegistrationApp({
    db,
    getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
    now: () => '2026-04-02T03:00:00.000Z',
    createId: (() => {
      let counter = 0;

      return () => {
        counter += 1;

        if (counter === 1) {
          return 'target-demo-1';
        }

        return `keyword-demo-${counter - 1}`;
      };
    })(),
  }),
);

seedReviewDemoTarget(db, workspace.id)
  .then((target) => {
    const liveTicker = startDashboardLiveTicker(db, workspace.id);

    server.listen(port, () => {
      process.stdout.write(`Target registration demo running on http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-owner\n`);
      process.stdout.write(`Member demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-member\n`);
      process.stdout.write(`Review demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/${target.id}/review?userId=user-owner\n`);
      process.stdout.write(`Alert settings demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/alerts?userId=user-owner\n`);
      process.stdout.write(`Article dashboard demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/articles?userId=user-owner\n`);

      function closeServer() {
        clearInterval(liveTicker);
        server.close(() => {
          db.close();
          process.exit(0);
        });
      }

      process.on('SIGINT', closeServer);
      process.on('SIGTERM', closeServer);
    });
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    db.close();
    process.exit(1);
  });
