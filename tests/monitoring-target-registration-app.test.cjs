'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  resolveEffectiveAlertPolicy,
  saveWorkspaceAlertPolicy,
} = require('../src/backend/alert-policy-service.cjs');
const {
  completedArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const {
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../src/db/schema/analysis-alert.cjs');
const { createWorkspace } = require('../src/backend/workspace-service.cjs');
const {
  getMonitoringTargetCollectorInput,
} = require('../src/backend/monitoring-target-service.cjs');
const {
  createMonitoringTargetRegistrationApp,
} = require('../src/http/monitoring-target-registration-app.cjs');

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
    status = 'review_required',
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
    bodyText = 'Article body',
    authorName,
    publisherName,
    publishedAt,
    fetchedAt = '2026-04-02T02:00:00.000Z',
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
    relevanceScore = 0.94,
    topicLabels = [],
    summary = null,
    riskScore,
    riskBand,
    rationale,
    modelVersion = 'gpt-5.4',
    relevanceScoredAt = '2026-04-02T02:01:00.000Z',
    topicsClassifiedAt = '2026-04-02T02:02:00.000Z',
    summaryGeneratedAt = '2026-04-02T02:03:00.000Z',
    riskScoredAt = '2026-04-02T02:04:00.000Z',
    createdAt = '2026-04-02T02:01:00.000Z',
    updatedAt = '2026-04-02T02:04:00.000Z',
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

function insertKeyword(
  db,
  {
    id,
    monitoringTargetId,
    keyword,
    sourceType = 'seed',
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

function insertProfile(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    summary,
    relatedEntities = [],
    aliases = [],
    searchResults = [],
    modelVersion = 'gpt-test-1',
    generatedAt = '2026-04-02T02:30:00.000Z',
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target_profile (
      id,
      workspace_id,
      monitoring_target_id,
      summary,
      related_entities_json,
      aliases_json,
      search_results_json,
      model_version,
      generated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    summary,
    JSON.stringify(relatedEntities),
    JSON.stringify(aliases),
    JSON.stringify(searchResults),
    modelVersion,
    generatedAt,
  );
}

function insertReview(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    reviewDecision,
    reviewedByMembershipId,
    reviewedAt,
    activatedByMembershipId = null,
    activatedAt = null,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target_review (
      id,
      workspace_id,
      monitoring_target_id,
      review_decision,
      reviewed_by_membership_id,
      reviewed_at,
      activated_by_membership_id,
      activated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    reviewDecision,
    reviewedByMembershipId,
    reviewedAt,
    activatedByMembershipId,
    activatedAt,
  );
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

function seedWorkspace(db) {
  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
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

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
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

function seedReviewReadyTarget(db) {
  insertMonitoringTarget(db, {
    id: 'target-review-1',
    workspaceId: 'workspace-1',
    type: 'company',
    displayName: 'Acme Holdings',
    note: 'Focus on founder and subsidiary coverage.',
    status: 'ready_for_review',
    defaultRiskThreshold: 83,
  });
  insertKeyword(db, {
    id: 'seed-review-1',
    monitoringTargetId: 'target-review-1',
    keyword: 'Acme Holdings',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'seed-review-2',
    monitoringTargetId: 'target-review-1',
    keyword: 'Acme founder',
    displayOrder: 1,
  });
  insertKeyword(db, {
    id: 'expanded-review-1',
    monitoringTargetId: 'target-review-1',
    keyword: 'Acme Labs',
    sourceType: 'expanded',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'expanded-review-2',
    monitoringTargetId: 'target-review-1',
    keyword: 'Jane Doe',
    sourceType: 'expanded',
    displayOrder: 1,
  });
  insertKeyword(db, {
    id: 'excluded-review-1',
    monitoringTargetId: 'target-review-1',
    keyword: 'Acme Jobs',
    sourceType: 'excluded',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'excluded-review-2',
    monitoringTargetId: 'target-review-1',
    keyword: 'Acme Careers',
    sourceType: 'excluded',
    displayOrder: 1,
  });
  insertProfile(db, {
    id: 'profile-review-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-review-1',
    summary:
      'Coverage points to Acme Holdings and its founder Jane Doe, with repeated references to the Acme Labs subsidiary.',
    relatedEntities: ['Jane Doe', 'Acme Labs'],
    aliases: ['Acme', 'Acme Holdings'],
    searchResults: [
      {
        keyword: 'Acme Holdings',
        results: [
          {
            title: 'Acme Holdings faces investor scrutiny',
            url: 'https://news.example.com/acme-investor-scrutiny',
            source: 'Google News',
          },
        ],
      },
    ],
  });
}

function seedArticleDashboardData(db) {
  insertMonitoringTarget(db, {
    id: 'target-dashboard-acme',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: 'active',
    defaultRiskThreshold: 83,
  });
  insertMonitoringTarget(db, {
    id: 'target-dashboard-jane',
    workspaceId: 'workspace-1',
    type: 'person',
    displayName: 'Jane Doe',
    status: 'active',
    defaultRiskThreshold: 78,
  });

  insertArticle(db, {
    id: 'article-dashboard-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-governance',
    canonicalUrl: 'https://example.com/acme-governance',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-1',
    workspaceId: 'workspace-1',
    title: 'Acme faces governance investigation after whistleblower filing',
    authorName: 'Naomi Park',
    publisherName: 'Financial Dispatch',
    publishedAt: '2026-04-02T02:45:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    topicLabels: ['governance', 'legal'],
    summary: 'Governance concerns intensified after the filing reached regulators.',
    riskScore: 92,
    riskBand: 'high',
    rationale: 'A whistleblower-backed probe can materially escalate regulatory risk.',
    updatedAt: '2026-04-02T02:51:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-1',
    topicLabel: 'governance',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-1',
    topicLabel: 'legal',
  });
  insertArticleCandidate(db, {
    id: 'candidate-dashboard-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    portalUrl: 'https://search.naver.com/acme-governance',
    sourceUrl: 'https://example.com/acme-governance',
  });
  insertArticleCandidate(db, {
    id: 'candidate-dashboard-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-1',
    portalUrl: 'https://news.google.com/acme-governance',
    sourceUrl: 'https://example.com/acme-governance',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'Acme Holdings',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: keywordArticleAnalysisRelevanceSignalType,
    signalValue: 'whistleblower filing',
  });
  insertRelevanceSignal(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-1',
    signalType: entityArticleAnalysisRelevanceSignalType,
    signalValue: 'regulators',
  });

  insertArticle(db, {
    id: 'article-dashboard-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/acme-recall',
    canonicalUrl: 'https://example.com/acme-recall',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-2',
    workspaceId: 'workspace-1',
    title: 'Acme expands recall to a second product line',
    authorName: 'Owen Choi',
    publisherName: 'Daily Ledger',
    publishedAt: '2026-04-02T01:40:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-dashboard-acme',
    articleId: 'article-dashboard-2',
    topicLabels: ['operations'],
    summary: 'The recall widened and raised questions about production oversight.',
    riskScore: 68,
    riskBand: 'medium',
    rationale: 'Operational disruption remains material, but the issue is still bounded.',
    updatedAt: '2026-04-02T01:46:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-2',
    topicLabel: 'operations',
  });

  insertArticle(db, {
    id: 'article-dashboard-3',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://example.com/jane-doe-townhall',
    canonicalUrl: 'https://example.com/jane-doe-townhall',
  });
  insertArticleContent(db, {
    articleId: 'article-dashboard-3',
    workspaceId: 'workspace-1',
    title: 'Jane Doe outlines a cautious hiring plan in town hall remarks',
    authorName: 'Mina Han',
    publisherName: 'financial dispatch',
    publishedAt: '2026-04-01T22:20:00.000Z',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-dashboard-3',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-dashboard-jane',
    articleId: 'article-dashboard-3',
    topicLabels: ['people'],
    summary: 'Leadership messaging stayed measured and low risk.',
    riskScore: 24,
    riskBand: 'low',
    rationale: 'The remarks are routine and do not indicate immediate downside.',
    updatedAt: '2026-04-01T22:29:00.000Z',
  });
  insertTopicLabel(db, {
    workspaceId: 'workspace-1',
    articleAnalysisId: 'analysis-dashboard-3',
    topicLabel: 'people',
  });
}

function startServer(db, options = {}) {
  return new Promise((resolve) => {
    const server = http.createServer(
      createMonitoringTargetRegistrationApp({
        db,
        getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
        now: options.now ?? (() => '2026-04-02T03:00:00.000Z'),
        createId:
          options.createId ??
          createIdGenerator(
            'target-1',
            'keyword-1',
            'keyword-2',
            'review-1',
            'target-2',
            'keyword-3',
            'keyword-4',
            'review-2',
          ),
      }),
    );

    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function request(server, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

test('target registration page shows the creation form for active workspace members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/new?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Register a monitoring target/u);
    assert.match(response.body, /name="type"/u);
    assert.match(response.body, /name="displayName"/u);
    assert.match(response.body, /name="defaultRiskThreshold"/u);
    assert.match(response.body, /name="seedKeywords"/u);
    assert.match(response.body, /setCustomValidity/u);
    assert.match(response.body, /Enter at least one seed keyword\./u);
    assert.match(response.body, /Save target and continue to review/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration rejects empty seed keyword submissions and preserves form values', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/new?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'type=company&displayName=Acme+Holdings&note=Needs+review&defaultRiskThreshold=88&seedKeywords=++++',
    });

    assert.equal(response.statusCode, 303);
    assert.equal(
      response.headers.location,
      '/workspaces/workspace-1/targets/new?userId=user-owner&error=At+least+one+seed+keyword+is+required&type=company&displayName=Acme+Holdings&note=Needs+review&defaultRiskThreshold=88&seedKeywords=++++',
    );

    const targetCount = db
      .prepare(`
        SELECT COUNT(*) AS target_count
        FROM monitoring_target
      `)
      .get();

    assert.equal(targetCount.target_count, 0);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration creates the target and redirects into the review workflow', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const createResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/new?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'type=person&displayName=Alex+Kim&note=Track+executive+coverage&defaultRiskThreshold=82&seedKeywords=Alex+Kim%0AAlex+Kim+CEO',
    });

    assert.equal(createResponse.statusCode, 303);
    assert.equal(
      createResponse.headers.location,
      '/workspaces/workspace-1/targets/target-1/review?userId=user-member&created=1',
    );

    const target = db
      .prepare(`
        SELECT id, workspace_id, type, display_name, note, status, default_risk_threshold
        FROM monitoring_target
        WHERE id = ?
      `)
      .get('target-1');
    const savedKeywords = db
      .prepare(`
        SELECT keyword, display_order
        FROM target_keyword
        WHERE monitoring_target_id = ?
        ORDER BY display_order
      `)
      .all('target-1')
      .map((row) => ({ ...row }));

    assert.deepEqual({ ...target }, {
      id: 'target-1',
      workspace_id: 'workspace-1',
      type: 'person',
      display_name: 'Alex Kim',
      note: 'Track executive coverage',
      status: 'review_required',
      default_risk_threshold: 82,
    });
    assert.deepEqual(savedKeywords, [
      {
        keyword: 'Alex Kim',
        display_order: 0,
      },
      {
        keyword: 'Alex Kim CEO',
        display_order: 1,
      },
    ]);

    const reviewResponse = await request(server, {
      path: createResponse.headers.location,
    });

    assert.equal(reviewResponse.statusCode, 200);
    assert.match(reviewResponse.body, /Monitoring target review/u);
    assert.match(reviewResponse.body, /Target saved/u);
    assert.match(reviewResponse.body, /Alex Kim/u);
    assert.match(reviewResponse.body, /review_required/u);
    assert.match(reviewResponse.body, /Alex Kim CEO/u);
    assert.match(reviewResponse.body, /Discovery pending/u);
    assert.match(
      reviewResponse.body,
      /Review decisions stay locked until discovery generates a profile\./u,
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review page shows generated profile signals and keeps activation disabled before review save', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Acme Holdings/u);
    assert.match(response.body, /Jane Doe/u);
    assert.match(response.body, /Acme Labs/u);
    assert.match(response.body, /Acme founder/u);
    assert.match(response.body, /Acme Jobs/u);
    assert.match(response.body, /Seed keywords/u);
    assert.match(response.body, /Expanded keywords/u);
    assert.match(response.body, /Excluded keywords/u);
    assert.match(response.body, /value="add-keyword"/u);
    assert.match(response.body, /value="disable-keyword"/u);
    assert.match(response.body, /value="remove-keyword"/u);
    assert.match(response.body, /name="decision"/u);
    assert.match(response.body, /value="match"/u);
    assert.match(response.body, /value="partial_match"/u);
    assert.match(response.body, /value="mismatch"/u);
    assert.match(
      response.body,
      /Save a match or partial_match review decision to unlock activation\./u,
    );
    assert.match(
      response.body,
      /<button type="submit" disabled>Activate monitoring target<\/button>/u,
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review POST cannot save a decision before a generated profile exists', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const createResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/new?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'type=company&displayName=Acme+Holdings&note=Needs+profile&defaultRiskThreshold=83&seedKeywords=Acme+Holdings',
    });

    assert.equal(createResponse.statusCode, 303);

    const reviewResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-1/review?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-review&decision=match',
    });

    assert.equal(reviewResponse.statusCode, 303);
    assert.equal(
      reviewResponse.headers.location,
      '/workspaces/workspace-1/targets/target-1/review?userId=user-owner&error=A+generated+target+profile+is+required+before+review+decisions+can+be+saved',
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review keeps activation disabled for legacy approval state without a generated profile', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  insertMonitoringTarget(db, {
    id: 'target-awaiting-no-profile',
    workspaceId: 'workspace-1',
    displayName: 'Legacy Target',
    status: 'awaiting_activation',
  });
  insertReview(db, {
    id: 'review-legacy-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-awaiting-no-profile',
    reviewDecision: 'partial_match',
    reviewedByMembershipId: 'membership-owner',
    reviewedAt: '2026-04-02T02:40:00.000Z',
  });
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/target-awaiting-no-profile/review?userId=user-owner',
    });

    assert.equal(response.statusCode, 200);
    assert.match(
      response.body,
      /A generated target profile is required before activation\./u,
    );
    assert.match(
      response.body,
      /<button type="submit" disabled>Activate monitoring target<\/button>/u,
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review sanitizes non-http discovery evidence links', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  db.prepare(`
    UPDATE monitoring_target_profile
    SET search_results_json = ?
    WHERE monitoring_target_id = ?
  `).run(
    JSON.stringify([
      {
        keyword: 'Acme Holdings',
        results: [
          {
            title: 'Unsafe result',
            url: 'javascript:alert(1)',
            source: 'Bad Feed',
          },
        ],
      },
    ]),
    'target-review-1',
  );
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-owner',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Unsafe result/u);
    assert.doesNotMatch(response.body, /href="javascript:alert\(1\)"/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review keyword actions persist add disable remove changes through activation', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db, {
    createId: createIdGenerator('excluded-review-3', 'review-route-1'),
  });

  try {
    const addResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=add-keyword&sourceType=excluded&keyword=Acme+Hiring',
    });

    assert.equal(addResponse.statusCode, 303);
    assert.equal(
      addResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&keywordAction=added&keywordSourceType=excluded',
    );

    const disableResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=disable-keyword&targetKeywordId=expanded-review-2',
    });

    assert.equal(disableResponse.statusCode, 303);
    assert.equal(
      disableResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&keywordAction=disabled&keywordSourceType=expanded',
    );

    const removeResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=remove-keyword&targetKeywordId=excluded-review-1',
    });

    assert.equal(removeResponse.statusCode, 303);
    assert.equal(
      removeResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&keywordAction=removed&keywordSourceType=excluded',
    );

    const saveResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-review&decision=partial_match',
    });

    assert.equal(saveResponse.statusCode, 303);
    assert.equal(
      saveResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&reviewSaved=partial_match',
    );

    const activateResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=activate',
    });

    assert.equal(activateResponse.statusCode, 303);
    assert.equal(
      activateResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&activated=1',
    );

    const collectorInput = getMonitoringTargetCollectorInput({
      db,
      workspaceId: 'workspace-1',
      monitoringTargetId: 'target-review-1',
    });
    const savedTarget = db
      .prepare(`
        SELECT status
        FROM monitoring_target
        WHERE id = ?
      `)
      .get('target-review-1');

    assert.deepEqual(collectorInput.expandedKeywords, [
      {
        id: 'expanded-review-1',
        keyword: 'Acme Labs',
        sourceType: 'expanded',
        isActive: 1,
        displayOrder: 0,
      },
    ]);
    assert.deepEqual(collectorInput.excludedKeywords, [
      {
        id: 'excluded-review-2',
        keyword: 'Acme Careers',
        sourceType: 'excluded',
        isActive: 1,
        displayOrder: 0,
      },
      {
        id: 'excluded-review-3',
        keyword: 'Acme Hiring',
        sourceType: 'excluded',
        isActive: 1,
        displayOrder: 1,
      },
    ]);
    assert.deepEqual({ ...savedTarget }, {
      status: 'active',
    });

    const activatedResponse = await request(server, {
      path: activateResponse.headers.location,
    });

    assert.equal(activatedResponse.statusCode, 200);
    assert.match(activatedResponse.body, /Target activated/u);
    assert.match(activatedResponse.body, /Acme Careers/u);
    assert.match(activatedResponse.body, /Acme Hiring/u);
    assert.match(activatedResponse.body, /disabled/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review saves a decision and exposes activation for approved targets', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db, {
    createId: createIdGenerator('review-route-1'),
  });

  try {
    const saveResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-review&decision=partial_match',
    });

    assert.equal(saveResponse.statusCode, 303);
    assert.equal(
      saveResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&reviewSaved=partial_match',
    );

    const savedTarget = db
      .prepare(`
        SELECT status
        FROM monitoring_target
        WHERE id = ?
      `)
      .get('target-review-1');
    const savedReview = db
      .prepare(`
        SELECT id, review_decision, reviewed_by_membership_id, reviewed_at
        FROM monitoring_target_review
        WHERE monitoring_target_id = ?
      `)
      .get('target-review-1');

    assert.deepEqual({ ...savedTarget }, {
      status: 'awaiting_activation',
    });
    assert.deepEqual({ ...savedReview }, {
      id: 'review-route-1',
      review_decision: 'partial_match',
      reviewed_by_membership_id: 'membership-member',
      reviewed_at: '2026-04-02T03:00:00.000Z',
    });

    const reviewResponse = await request(server, {
      path: saveResponse.headers.location,
    });

    assert.equal(reviewResponse.statusCode, 200);
    assert.match(reviewResponse.body, /Review saved/u);
    assert.match(reviewResponse.body, /partial_match/u);
    assert.match(
      reviewResponse.body,
      /Activation is ready for this approved target\./u,
    );
    assert.doesNotMatch(
      reviewResponse.body,
      /<button type="submit" disabled>Activate monitoring target<\/button>/u,
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target review activates an approved target from the review workflow', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  insertReview(db, {
    id: 'review-existing-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-review-1',
    reviewDecision: 'match',
    reviewedByMembershipId: 'membership-member',
    reviewedAt: '2026-04-02T02:45:00.000Z',
  });
  db.prepare(`
    UPDATE monitoring_target
    SET status = 'awaiting_activation'
    WHERE id = 'target-review-1'
  `).run();
  const server = await startServer(db);

  try {
    const activateResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=activate',
    });

    assert.equal(activateResponse.statusCode, 303);
    assert.equal(
      activateResponse.headers.location,
      '/workspaces/workspace-1/targets/target-review-1/review?userId=user-member&activated=1',
    );

    const savedTarget = db
      .prepare(`
        SELECT status
        FROM monitoring_target
        WHERE id = ?
      `)
      .get('target-review-1');
    const savedReview = db
      .prepare(`
        SELECT activated_by_membership_id, activated_at
        FROM monitoring_target_review
        WHERE monitoring_target_id = ?
      `)
      .get('target-review-1');

    assert.deepEqual({ ...savedTarget }, {
      status: 'active',
    });
    assert.deepEqual({ ...savedReview }, {
      activated_by_membership_id: 'membership-member',
      activated_at: '2026-04-02T03:00:00.000Z',
    });

    const reviewResponse = await request(server, {
      path: activateResponse.headers.location,
    });

    assert.equal(reviewResponse.statusCode, 200);
    assert.match(reviewResponse.body, /Target activated/u);
    assert.match(reviewResponse.body, /status-pill">active<\/span>/u);
    assert.match(
      reviewResponse.body,
      /This monitoring target is already active\./u,
    );
    assert.match(
      reviewResponse.body,
      /Keyword editing is read-only in this workflow after activation\./u,
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration page rejects users outside the workspace', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/new?userId=user-outsider',
    });

    assert.equal(response.statusCode, 403);
    assert.equal(
      response.body,
      'Only active workspace members can create monitoring targets',
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('alert settings page shows workspace defaults and target override editors for workspace admins', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  saveWorkspaceAlertPolicy({
    db,
    workspaceId: 'workspace-1',
    userId: 'user-owner',
    riskThreshold: 78,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/WORKSPACE',
    emailEnabled: true,
    emailRecipients: ['desk@example.com'],
    createId: createIdGenerator('policy-workspace-1'),
    now: () => '2026-04-02T03:10:00.000Z',
  });
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Alert settings/u);
    assert.match(response.body, /Acme Risk Desk/u);
    assert.match(response.body, /Workspace defaults/u);
    assert.match(response.body, /Target overrides/u);
    assert.match(response.body, /Acme Holdings/u);
    assert.match(response.body, /Save workspace defaults/u);
    assert.match(response.body, /Save target override/u);
    assert.match(response.body, /Workspace default/u);
    assert.match(response.body, /https:\/\/hooks\.slack\.com\/services\/T000\/B000\/WORKSPACE/u);
    assert.match(response.body, /desk@example\.com/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('alert settings page requires a workspace admin', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/alerts?userId=user-member',
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body, 'Only active workspace admins can manage alert policies');
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('alert settings page renders inline validation errors for slack, email, and sms inputs', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db);

  try {
    const invalidSlackResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-workspace-alert-settings&riskThreshold=82&slackEnabled=1&slackWebhookUrl=https%3A%2F%2Fexample.com%2Fnot-slack',
    });

    assert.equal(invalidSlackResponse.statusCode, 303);
    assert.match(invalidSlackResponse.headers.location, /scope=workspace/u);
    assert.match(invalidSlackResponse.headers.location, /errorField=slackWebhookUrl/u);

    const invalidSlackPage = await request(server, {
      path: invalidSlackResponse.headers.location,
    });

    assert.equal(invalidSlackPage.statusCode, 200);
    assert.match(invalidSlackPage.body, /slackWebhookUrl must be a valid Slack webhook URL/u);
    assert.match(invalidSlackPage.body, /https:\/\/example\.com\/not-slack/u);

    const invalidEmailResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-target-alert-settings&monitoringTargetId=target-review-1&riskThreshold=83&emailEnabled=1&emailRecipients=not-an-email',
    });

    assert.equal(invalidEmailResponse.statusCode, 303);
    assert.match(invalidEmailResponse.headers.location, /scope=target/u);
    assert.match(invalidEmailResponse.headers.location, /monitoringTargetId=target-review-1/u);
    assert.match(invalidEmailResponse.headers.location, /errorField=emailRecipients/u);

    const invalidEmailPage = await request(server, {
      path: invalidEmailResponse.headers.location,
    });

    assert.equal(invalidEmailPage.statusCode, 200);
    assert.match(invalidEmailPage.body, /emailRecipients contains an invalid email address/u);
    assert.match(invalidEmailPage.body, />not-an-email<\/textarea>/u);

    const invalidSmsResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-target-alert-settings&monitoringTargetId=target-review-1&riskThreshold=83&smsEnabled=1&smsRecipients=202-555-0100',
    });

    assert.equal(invalidSmsResponse.statusCode, 303);
    assert.match(invalidSmsResponse.headers.location, /errorField=smsRecipients/u);

    const invalidSmsPage = await request(server, {
      path: invalidSmsResponse.headers.location,
    });

    assert.equal(invalidSmsPage.statusCode, 200);
    assert.match(invalidSmsPage.body, /smsRecipients contains an invalid E\.164 phone number/u);
    assert.match(invalidSmsPage.body, />202-555-0100<\/textarea>/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('alert settings page saves workspace defaults and target overrides with effective policy summaries', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedReviewReadyTarget(db);
  const server = await startServer(db, {
    createId: createIdGenerator('policy-workspace-1', 'policy-target-1'),
  });

  try {
    const workspaceSaveResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-workspace-alert-settings&riskThreshold=78&slackEnabled=1&slackWebhookUrl=https%3A%2F%2Fhooks.slack.com%2Fservices%2FT000%2FB000%2FWORKSPACE&emailEnabled=1&emailRecipients=desk%40example.com',
    });

    assert.equal(workspaceSaveResponse.statusCode, 303);
    assert.equal(
      workspaceSaveResponse.headers.location,
      '/workspaces/workspace-1/alerts?userId=user-owner&scope=workspace&saved=workspace',
    );

    const targetSaveResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/alerts?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=save-target-alert-settings&monitoringTargetId=target-review-1&riskThreshold=91&emailEnabled=1&emailRecipients=owner%40example.com&smsEnabled=1&smsRecipients=%2B12025550111',
    });

    assert.equal(targetSaveResponse.statusCode, 303);
    assert.equal(
      targetSaveResponse.headers.location,
      '/workspaces/workspace-1/alerts?userId=user-owner&scope=target&monitoringTargetId=target-review-1&saved=target',
    );

    const workspacePolicy = resolveEffectiveAlertPolicy({
      db,
      workspaceId: 'workspace-1',
    });
    const targetPolicy = resolveEffectiveAlertPolicy({
      db,
      workspaceId: 'workspace-1',
      monitoringTargetId: 'target-review-1',
    });

    assert.deepEqual(workspacePolicy, {
      id: 'policy-workspace-1',
      workspaceId: 'workspace-1',
      monitoringTargetId: null,
      scope: 'workspace',
      riskThreshold: 78,
      slackEnabled: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/WORKSPACE',
      emailEnabled: true,
      emailRecipients: ['desk@example.com'],
      smsEnabled: false,
      smsRecipients: [],
    });
    assert.deepEqual(targetPolicy, {
      id: 'policy-target-1',
      workspaceId: 'workspace-1',
      monitoringTargetId: 'target-review-1',
      scope: 'target',
      riskThreshold: 91,
      slackEnabled: false,
      slackWebhookUrl: null,
      emailEnabled: true,
      emailRecipients: ['owner@example.com'],
      smsEnabled: true,
      smsRecipients: ['+12025550111'],
    });

    const reloadedPage = await request(server, {
      path: targetSaveResponse.headers.location,
    });

    assert.equal(reloadedPage.statusCode, 200);
    assert.match(reloadedPage.body, /Target override saved/u);
    assert.match(reloadedPage.body, /Target override/u);
    assert.match(reloadedPage.body, /value="91"/u);
    assert.match(reloadedPage.body, /owner@example\.com/u);
    assert.match(reloadedPage.body, /\+12025550111/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('article dashboard page renders live feed cards, filters, and polling script for active workspace members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/articles?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Track incoming risk coverage without leaving the feed\./u);
    assert.match(response.body, /name="monitoringTargetId"/u);
    assert.match(response.body, /name="riskBand"/u);
    assert.match(response.body, /name="topicLabel"/u);
    assert.match(response.body, /name="publisher"/u);
    assert.match(response.body, /name="reporter"/u);
    assert.match(response.body, /name="publishedFrom"/u);
    assert.match(response.body, /name="publishedTo"/u);
    assert.match(response.body, /value="highest_risk"/u);
    assert.match(response.body, /value="newest"/u);
    assert.match(response.body, /Acme faces governance investigation after whistleblower filing/u);
    assert.match(response.body, /Acme expands recall to a second product line/u);
    assert.match(response.body, /Jane Doe outlines a cautious hiring plan in town hall remarks/u);
    assert.match(response.body, /Financial Dispatch/u);
    assert.match(response.body, /Naomi Park/u);
    assert.match(response.body, /Inspect article/u);
    assert.match(
      response.body,
      /href="\/workspaces\/workspace-1\/articles\/analysis-dashboard-1\?userId=user-member"/u,
    );
    assert.match(response.body, /data-live-results/u);
    assert.match(response.body, /window\.__articleDashboardRefreshCount/u);
    assert.match(response.body, /polls the server without reloading the page/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('analytics dashboard page renders summary lanes and drilldown links for active workspace members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/analytics?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(
      response.body,
      /See which targets, publishers, and reporters keep resurfacing in high-risk coverage\./u,
    );
    assert.match(response.body, /name="monitoringTargetId"/u);
    assert.match(response.body, /name="publishedFrom"/u);
    assert.match(response.body, /name="publishedTo"/u);
    assert.match(response.body, /Topic spikes/u);
    assert.match(response.body, /Publisher concentration/u);
    assert.match(response.body, /Reporter watchlist/u);
    assert.match(response.body, /governance/u);
    assert.match(response.body, /Financial Dispatch/u);
    assert.match(response.body, /Naomi Park/u);
    assert.match(
      response.body,
      /href="\/workspaces\/workspace-1\/articles\?userId=user-member&amp;riskBand=high&amp;sort=highest_risk&amp;topicLabel=governance"/u,
    );
    assert.match(response.body, /Open live article feed/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('article detail page is reachable from the dashboard and renders rationale, keywords, links, and timestamps', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/articles/analysis-dashboard-1?userId=user-member&monitoringTargetId=target-dashboard-acme&riskBand=high',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Back to live article dashboard/u);
    assert.match(
      response.body,
      /href="\/workspaces\/workspace-1\/articles\?userId=user-member&amp;monitoringTargetId=target-dashboard-acme&amp;riskBand=high"/u,
    );
    assert.match(response.body, /Acme faces governance investigation after whistleblower filing/u);
    assert.match(response.body, /Governance concerns intensified after the filing reached regulators\./u);
    assert.match(
      response.body,
      /A whistleblower-backed probe can materially escalate regulatory risk\./u,
    );
    assert.match(response.body, /Matched keywords/u);
    assert.match(response.body, /Acme Holdings/u);
    assert.match(response.body, /whistleblower filing/u);
    assert.match(response.body, /Entity signals/u);
    assert.match(response.body, /regulators/u);
    assert.match(response.body, /Source links/u);
    assert.match(response.body, /https:\/\/example\.com\/acme-governance/u);
    assert.match(response.body, /https:\/\/search\.naver\.com\/acme-governance/u);
    assert.match(response.body, /Latest stored analysis timestamps/u);
    assert.match(response.body, /Relevance scored/u);
    assert.match(response.body, /Summary generated/u);
    assert.match(response.body, /Risk scored/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('analytics dashboard filters persist into reporter drilldowns', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const analyticsPage = await request(server, {
      path: '/workspaces/workspace-1/analytics?userId=user-member&monitoringTargetId=target-dashboard-acme&publishedFrom=2026-04-02&publishedTo=2026-04-02',
    });

    assert.equal(analyticsPage.statusCode, 200);
    assert.match(analyticsPage.body, /<option value="target-dashboard-acme" selected>/u);
    assert.match(analyticsPage.body, /value="2026-04-02"/u);
    assert.match(
      analyticsPage.body,
      /href="\/workspaces\/workspace-1\/articles\?userId=user-member&amp;monitoringTargetId=target-dashboard-acme&amp;publishedFrom=2026-04-02&amp;publishedTo=2026-04-02&amp;riskBand=high&amp;sort=highest_risk&amp;reporter=Naomi\+Park"/u,
    );

    const drilldownPage = await request(server, {
      path: '/workspaces/workspace-1/articles?userId=user-member&monitoringTargetId=target-dashboard-acme&publishedFrom=2026-04-02&publishedTo=2026-04-02&riskBand=high&sort=highest_risk&reporter=Naomi+Park',
    });

    assert.equal(drilldownPage.statusCode, 200);
    assert.match(
      drilldownPage.body,
      /Acme faces governance investigation after whistleblower filing/u,
    );
    assert.doesNotMatch(drilldownPage.body, /Acme expands recall to a second product line/u);
    assert.doesNotMatch(
      drilldownPage.body,
      /Jane Doe outlines a cautious hiring plan in town hall remarks/u,
    );
    assert.match(drilldownPage.body, /name="reporter"/u);
    assert.match(drilldownPage.body, /value="Naomi Park"/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('article dashboard applies filters and serves fragment refresh responses', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const filteredPage = await request(server, {
      path: '/workspaces/workspace-1/articles?userId=user-member&monitoringTargetId=target-dashboard-acme&riskBand=high&topicLabel=governance&publisher=financial+dispatch&publishedFrom=2026-04-02&publishedTo=2026-04-02&sort=newest',
    });

    assert.equal(filteredPage.statusCode, 200);
    assert.match(filteredPage.body, /Acme faces governance investigation after whistleblower filing/u);
    assert.doesNotMatch(filteredPage.body, /Acme expands recall to a second product line/u);
    assert.doesNotMatch(filteredPage.body, /Jane Doe outlines a cautious hiring plan in town hall remarks/u);
    assert.match(filteredPage.body, /<option value="target-dashboard-acme" selected>/u);
    assert.match(filteredPage.body, /<option value="high" selected>/u);
    assert.match(filteredPage.body, /value="financial dispatch"/u);
    assert.match(filteredPage.body, /value="2026-04-02"/u);

    const fragmentResponse = await request(server, {
      path: '/workspaces/workspace-1/articles?userId=user-member&monitoringTargetId=target-dashboard-acme&riskBand=high&fragment=results',
    });

    assert.equal(fragmentResponse.statusCode, 200);
    assert.doesNotMatch(fragmentResponse.body, /<!doctype html>/u);
    assert.match(fragmentResponse.body, /results-summary/u);
    assert.match(fragmentResponse.body, /analysis-dashboard-1/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('article dashboard rejects invalid filter input', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  seedArticleDashboardData(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/articles?userId=user-member&sort=priority',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.body,
      'sort must be one of: highest_risk, lowest_risk, newest, oldest',
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});
