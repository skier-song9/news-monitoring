'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  PortalSearchCollectorError,
  runPortalSearchCollector,
} = require('../src/backend/portal-search-collector.cjs');
const {
  defaultArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const {
  activeMonitoringTargetStatus,
  defaultMonitoringTargetRiskThreshold,
  pausedMonitoringTargetStatus,
} = require('../src/db/schema/monitoring-target.cjs');
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
    defaultRiskThreshold = defaultMonitoringTargetRiskThreshold,
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

function insertArticle(db, { id, workspaceId, sourceUrl }) {
  db.prepare(`
    INSERT INTO article (id, workspace_id, source_url)
    VALUES (?, ?, ?)
  `).run(id, workspaceId, sourceUrl);
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
    ingestionError = null,
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
      ingestion_status,
      ingestion_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    portalUrl,
    sourceUrl,
    ingestionStatus,
    ingestionError,
  );
}

function insertArticleCandidatePortalMetadata(
  db,
  {
    articleCandidateId,
    workspaceId,
    portalName,
    portalTitle,
    portalSnippet = null,
    portalPublishedAt = null,
  },
) {
  db.prepare(`
    INSERT INTO article_candidate_portal_metadata (
      article_candidate_id,
      workspace_id,
      portal_name,
      portal_title,
      portal_snippet,
      portal_published_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    articleCandidateId,
    workspaceId,
    portalName,
    portalTitle,
    portalSnippet,
    portalPublishedAt,
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

function normalizeRow(row) {
  return row ? { ...row } : row;
}

test('runPortalSearchCollector searches only active targets and stores candidate metadata per portal', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-active',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    note: 'Founder coverage',
  });
  insertMonitoringTarget(db, {
    id: 'target-paused',
    workspaceId: 'workspace-1',
    displayName: 'Globex Holdings',
    status: pausedMonitoringTargetStatus,
  });
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-active',
    keyword: 'Acme Holdings',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'expanded-1',
    monitoringTargetId: 'target-active',
    keyword: 'Acme scandal',
    sourceType: expandedTargetKeywordSourceType,
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'expanded-disabled',
    monitoringTargetId: 'target-active',
    keyword: 'Disabled expansion',
    sourceType: expandedTargetKeywordSourceType,
    isActive: 0,
    displayOrder: 1,
  });
  insertKeyword(db, {
    id: 'excluded-1',
    monitoringTargetId: 'target-active',
    keyword: 'fan cam',
    sourceType: excludedTargetKeywordSourceType,
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'paused-seed-1',
    monitoringTargetId: 'target-paused',
    keyword: 'Globex Holdings',
  });

  const searchCalls = [];
  const collectorResult = await runPortalSearchCollector({
    db,
    now: () => '2026-03-30T14:00:00.000Z',
    createId: createIdGenerator('candidate-1', 'candidate-2', 'candidate-3'),
    searchNaverNews: async ({ monitoringTarget, collectorInput }) => {
      searchCalls.push({ portalName: 'naver', monitoringTarget, collectorInput });

      return [
        {
          portalUrl: 'https://news.naver.com/article/1',
          sourceUrl: 'https://source.example.com/article-1',
          title: 'Acme Holdings under review',
          snippet: 'Naver snippet',
          publishedAt: '2026-03-30T13:45:00.000Z',
        },
      ];
    },
    searchNateNews: async ({ monitoringTarget, collectorInput }) => {
      searchCalls.push({ portalName: 'nate', monitoringTarget, collectorInput });

      return [
        {
          portalUrl: 'https://news.nate.com/article/2',
          sourceUrl: 'https://source.example.com/article-2',
          title: 'Acme scandal follow-up',
          snippet: 'Nate snippet',
          publishedAt: '2026-03-30T13:50:00.000Z',
        },
      ];
    },
    searchGoogleNews: async ({ monitoringTarget, collectorInput }) => {
      searchCalls.push({ portalName: 'google_news', monitoringTarget, collectorInput });

      return [
        {
          portalUrl: 'https://news.google.com/articles/3',
          sourceUrl: 'https://source.example.com/article-3',
          title: 'Acme reaction round-up',
          snippet: 'Google snippet',
        },
      ];
    },
  });

  assert.equal(searchCalls.length, 3);

  for (const searchCall of searchCalls) {
    assert.deepEqual(searchCall.monitoringTarget, {
      id: 'target-active',
      workspaceId: 'workspace-1',
      type: 'company',
      displayName: 'Acme Holdings',
      note: 'Founder coverage',
      status: activeMonitoringTargetStatus,
      defaultRiskThreshold: defaultMonitoringTargetRiskThreshold,
    });
    assert.deepEqual(searchCall.collectorInput, {
      workspaceId: 'workspace-1',
      monitoringTargetId: 'target-active',
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
          keyword: 'Acme scandal',
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
    });
  }

  const savedCandidates = db
    .prepare(`
      SELECT c.id, c.workspace_id, c.monitoring_target_id, c.portal_url, c.source_url, c.ingestion_status,
             m.portal_name, m.portal_title, m.portal_snippet, m.portal_published_at
      FROM article_candidate c
      JOIN article_candidate_portal_metadata m
        ON m.article_candidate_id = c.id
      ORDER BY c.id
    `)
    .all()
    .map(normalizeRow);

  assert.deepEqual(savedCandidates, [
    {
      id: 'candidate-1',
      workspace_id: 'workspace-1',
      monitoring_target_id: 'target-active',
      portal_url: 'https://news.naver.com/article/1',
      source_url: 'https://source.example.com/article-1',
      ingestion_status: defaultArticleCandidateIngestionStatus,
      portal_name: 'naver',
      portal_title: 'Acme Holdings under review',
      portal_snippet: 'Naver snippet',
      portal_published_at: '2026-03-30T13:45:00.000Z',
    },
    {
      id: 'candidate-2',
      workspace_id: 'workspace-1',
      monitoring_target_id: 'target-active',
      portal_url: 'https://news.nate.com/article/2',
      source_url: 'https://source.example.com/article-2',
      ingestion_status: defaultArticleCandidateIngestionStatus,
      portal_name: 'nate',
      portal_title: 'Acme scandal follow-up',
      portal_snippet: 'Nate snippet',
      portal_published_at: '2026-03-30T13:50:00.000Z',
    },
    {
      id: 'candidate-3',
      workspace_id: 'workspace-1',
      monitoring_target_id: 'target-active',
      portal_url: 'https://news.google.com/articles/3',
      source_url: 'https://source.example.com/article-3',
      ingestion_status: defaultArticleCandidateIngestionStatus,
      portal_name: 'google_news',
      portal_title: 'Acme reaction round-up',
      portal_snippet: 'Google snippet',
      portal_published_at: null,
    },
  ]);
  assert.deepEqual(collectorResult, {
    processedTargets: [
      {
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-active',
        portals: [
          {
            portalName: 'naver',
            candidates: [
              {
                id: 'candidate-1',
                workspaceId: 'workspace-1',
                monitoringTargetId: 'target-active',
                portalName: 'naver',
                portalUrl: 'https://news.naver.com/article/1',
                sourceUrl: 'https://source.example.com/article-1',
                title: 'Acme Holdings under review',
                snippet: 'Naver snippet',
                publishedAt: '2026-03-30T13:45:00.000Z',
                ingestionStatus: defaultArticleCandidateIngestionStatus,
              },
            ],
          },
          {
            portalName: 'nate',
            candidates: [
              {
                id: 'candidate-2',
                workspaceId: 'workspace-1',
                monitoringTargetId: 'target-active',
                portalName: 'nate',
                portalUrl: 'https://news.nate.com/article/2',
                sourceUrl: 'https://source.example.com/article-2',
                title: 'Acme scandal follow-up',
                snippet: 'Nate snippet',
                publishedAt: '2026-03-30T13:50:00.000Z',
                ingestionStatus: defaultArticleCandidateIngestionStatus,
              },
            ],
          },
          {
            portalName: 'google_news',
            candidates: [
              {
                id: 'candidate-3',
                workspaceId: 'workspace-1',
                monitoringTargetId: 'target-active',
                portalName: 'google_news',
                portalUrl: 'https://news.google.com/articles/3',
                sourceUrl: 'https://source.example.com/article-3',
                title: 'Acme reaction round-up',
                snippet: 'Google snippet',
                publishedAt: null,
                ingestionStatus: defaultArticleCandidateIngestionStatus,
              },
            ],
          },
        ],
      },
    ],
    totalCandidates: 3,
  });

  db.close();
});

test('runPortalSearchCollector upserts existing retryable candidates instead of duplicating them', async () => {
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
  insertArticleCandidate(db, {
    id: 'candidate-existing',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    portalUrl: 'https://news.naver.com/article/1',
    sourceUrl: 'https://source.example.com/stale',
    ingestionStatus: 'failed',
    ingestionError: 'timeout',
  });
  insertArticleCandidatePortalMetadata(db, {
    articleCandidateId: 'candidate-existing',
    workspaceId: 'workspace-1',
    portalName: 'naver',
    portalTitle: 'Old headline',
    portalSnippet: 'Old snippet',
  });

  const collectorResult = await runPortalSearchCollector({
    db,
    now: () => '2026-03-30T15:00:00.000Z',
    createId: createIdGenerator('candidate-new'),
    searchNaverNews: async () => [
      {
        portalUrl: 'https://news.naver.com/article/1',
        sourceUrl: 'https://source.example.com/fresh',
        title: 'Fresh headline',
        snippet: 'Fresh snippet',
        publishedAt: '2026-03-30T14:58:00.000Z',
      },
    ],
    searchNateNews: async () => [],
    searchGoogleNews: async () => [],
  });

  const savedCandidate = db
    .prepare(`
      SELECT c.id, c.source_url, c.ingestion_status, c.ingestion_error,
             m.portal_title, m.portal_snippet, m.portal_published_at
      FROM article_candidate c
      JOIN article_candidate_portal_metadata m
        ON m.article_candidate_id = c.id
      WHERE c.monitoring_target_id = ? AND c.portal_url = ?
    `)
    .get('target-1', 'https://news.naver.com/article/1');
  const candidateCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM article_candidate
      WHERE monitoring_target_id = ?
    `)
    .get('target-1');

  assert.deepEqual(normalizeRow(savedCandidate), {
    id: 'candidate-existing',
    source_url: 'https://source.example.com/fresh',
    ingestion_status: defaultArticleCandidateIngestionStatus,
    ingestion_error: null,
    portal_title: 'Fresh headline',
    portal_snippet: 'Fresh snippet',
    portal_published_at: '2026-03-30T14:58:00.000Z',
  });
  assert.equal(candidateCount.count, 1);
  assert.equal(collectorResult.totalCandidates, 1);

  db.close();
});

test('runPortalSearchCollector preserves linked candidates while refreshing portal metadata', async () => {
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
    sourceUrl: 'https://source.example.com/linked',
  });
  insertArticleCandidate(db, {
    id: 'candidate-linked',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    portalUrl: 'https://news.google.com/articles/linked',
    sourceUrl: 'https://source.example.com/linked',
    ingestionStatus: linkedArticleCandidateIngestionStatus,
  });
  insertArticleCandidatePortalMetadata(db, {
    articleCandidateId: 'candidate-linked',
    workspaceId: 'workspace-1',
    portalName: 'google_news',
    portalTitle: 'Old linked headline',
  });

  await runPortalSearchCollector({
    db,
    now: () => '2026-03-30T15:30:00.000Z',
    searchNaverNews: async () => [],
    searchNateNews: async () => [],
    searchGoogleNews: async () => [
      {
        portalUrl: 'https://news.google.com/articles/linked',
        sourceUrl: 'https://source.example.com/linked',
        title: 'Updated linked headline',
      },
    ],
  });

  const savedCandidate = db
    .prepare(`
      SELECT c.id, c.article_id, c.ingestion_status, m.portal_title
      FROM article_candidate c
      JOIN article_candidate_portal_metadata m
        ON m.article_candidate_id = c.id
      WHERE c.id = ?
    `)
    .get('candidate-linked');

  assert.deepEqual(normalizeRow(savedCandidate), {
    id: 'candidate-linked',
    article_id: 'article-1',
    ingestion_status: linkedArticleCandidateIngestionStatus,
    portal_title: 'Updated linked headline',
  });

  db.close();
});

test('runPortalSearchCollector rejects invalid portal search payloads', async () => {
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

  await assert.rejects(
    () =>
      runPortalSearchCollector({
        db,
        searchNaverNews: async () => [{ portalUrl: 'https://news.naver.com/article/1' }],
        searchNateNews: async () => [],
        searchGoogleNews: async () => [],
      }),
    (error) => {
      assert.equal(error instanceof PortalSearchCollectorError, true);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /naverResults\[0\]\.title must be a string/u);
      return true;
    },
  );

  db.close();
});
