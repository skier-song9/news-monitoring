'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  MonitoringTargetDiscoveryJobError,
  runMonitoringTargetDiscoveryJob,
} = require('../src/backend/monitoring-target-discovery-job.cjs');
const {
  defaultMonitoringTargetRiskThreshold,
  monitoringTargetReadyForReviewStatus,
} = require('../src/db/schema/monitoring-target.cjs');
const {
  defaultTargetKeywordIsActive,
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

function insertUser(db, { id, email, displayName }) {
  db.prepare(`
    INSERT INTO user_account (id, email, display_name)
    VALUES (?, ?, ?)
  `).run(id, email, displayName);
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
    status = 'review_required',
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
    modelVersion,
    generatedAt,
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
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target_review (
      id,
      workspace_id,
      monitoring_target_id,
      review_decision,
      reviewed_by_membership_id,
      reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, monitoringTargetId, reviewDecision, reviewedByMembershipId, reviewedAt);
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

test('runMonitoringTargetDiscoveryJob stores a generated profile and ready-for-review keywords', async () => {
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
    note: ' Tracks founder issues ',
    defaultRiskThreshold: 82,
  });
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
    displayOrder: 0,
  });
  insertKeyword(db, {
    id: 'seed-2',
    monitoringTargetId: 'target-1',
    keyword: 'Acme founder',
    displayOrder: 1,
  });

  const searchCalls = [];
  const discoveryResult = await runMonitoringTargetDiscoveryJob({
    db,
    monitoringTargetId: 'target-1',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('profile-1', 'expanded-1', 'expanded-2'),
    searchWeb: async ({ monitoringTarget, keyword }) => {
      searchCalls.push(keyword);

      assert.deepEqual(monitoringTarget, {
        id: 'target-1',
        workspaceId: 'workspace-1',
        type: 'company',
        displayName: 'Acme Holdings',
        note: ' Tracks founder issues ',
        status: 'review_required',
        defaultRiskThreshold: 82,
      });

      return [
        {
          title: `${keyword} headline`,
          url: `https://search.example.com/${encodeURIComponent(keyword)}`,
          snippet: `${keyword} snippet`,
          source: 'Google News',
        },
      ];
    },
    generateTargetProfile: async ({ monitoringTarget, seedKeywords, searchResults }) => {
      assert.equal(monitoringTarget.id, 'target-1');
      assert.deepEqual(seedKeywords, [
        {
          id: 'seed-1',
          keyword: 'Acme Holdings',
        },
        {
          id: 'seed-2',
          keyword: 'Acme founder',
        },
      ]);
      assert.deepEqual(searchResults, [
        {
          keyword: 'Acme Holdings',
          results: [
            {
              title: 'Acme Holdings headline',
              url: 'https://search.example.com/Acme%20Holdings',
              snippet: 'Acme Holdings snippet',
              source: 'Google News',
            },
          ],
        },
        {
          keyword: 'Acme founder',
          results: [
            {
              title: 'Acme founder headline',
              url: 'https://search.example.com/Acme%20founder',
              snippet: 'Acme founder snippet',
              source: 'Google News',
            },
          ],
        },
      ]);

      return {
        summary: 'Acme Holdings is a Korean conglomerate associated with founder-driven coverage.',
        relatedEntities: ['Jane Doe', 'Acme Labs', 'Jane Doe'],
        aliases: ['Acme', 'Acme Holdings'],
        expandedKeywords: ['Acme Holdings', 'Acme scandal', 'Acme scandal', 'Jane Doe Acme'],
        modelVersion: 'gpt-5.4-test',
      };
    },
  });

  const savedTarget = db
    .prepare('SELECT status FROM monitoring_target WHERE id = ?')
    .get('target-1');
  const savedProfile = db
    .prepare(`
      SELECT id, summary, related_entities_json, aliases_json, search_results_json, model_version, generated_at
      FROM monitoring_target_profile
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');
  const expandedKeywords = db
    .prepare(`
      SELECT id, keyword, source_type, is_active, display_order
      FROM target_keyword
      WHERE monitoring_target_id = ? AND source_type = ?
      ORDER BY display_order
    `)
    .all('target-1', expandedTargetKeywordSourceType)
    .map(normalizeRow);

  assert.deepEqual(searchCalls, ['Acme Holdings', 'Acme founder']);
  assert.equal(savedTarget.status, monitoringTargetReadyForReviewStatus);
  assert.deepEqual(normalizeRow(savedProfile), {
    id: 'profile-1',
    summary: 'Acme Holdings is a Korean conglomerate associated with founder-driven coverage.',
    related_entities_json: JSON.stringify(['Jane Doe', 'Acme Labs']),
    aliases_json: JSON.stringify(['Acme', 'Acme Holdings']),
    search_results_json: JSON.stringify([
      {
        keyword: 'Acme Holdings',
        results: [
          {
            title: 'Acme Holdings headline',
            url: 'https://search.example.com/Acme%20Holdings',
            snippet: 'Acme Holdings snippet',
            source: 'Google News',
          },
        ],
      },
      {
        keyword: 'Acme founder',
        results: [
          {
            title: 'Acme founder headline',
            url: 'https://search.example.com/Acme%20founder',
            snippet: 'Acme founder snippet',
            source: 'Google News',
          },
        ],
      },
    ]),
    model_version: 'gpt-5.4-test',
    generated_at: '2026-03-30T12:00:00.000Z',
  });
  assert.deepEqual(expandedKeywords, [
    {
      id: 'expanded-1',
      keyword: 'Acme scandal',
      source_type: expandedTargetKeywordSourceType,
      is_active: defaultTargetKeywordIsActive,
      display_order: 0,
    },
    {
      id: 'expanded-2',
      keyword: 'Jane Doe Acme',
      source_type: expandedTargetKeywordSourceType,
      is_active: defaultTargetKeywordIsActive,
      display_order: 1,
    },
  ]);
  assert.deepEqual(discoveryResult, {
    id: 'profile-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    status: monitoringTargetReadyForReviewStatus,
    summary: 'Acme Holdings is a Korean conglomerate associated with founder-driven coverage.',
    relatedEntities: ['Jane Doe', 'Acme Labs'],
    aliases: ['Acme', 'Acme Holdings'],
    searchResults: [
      {
        keyword: 'Acme Holdings',
        results: [
          {
            title: 'Acme Holdings headline',
            url: 'https://search.example.com/Acme%20Holdings',
            snippet: 'Acme Holdings snippet',
            source: 'Google News',
          },
        ],
      },
      {
        keyword: 'Acme founder',
        results: [
          {
            title: 'Acme founder headline',
            url: 'https://search.example.com/Acme%20founder',
            snippet: 'Acme founder snippet',
            source: 'Google News',
          },
        ],
      },
    ],
    expandedKeywords: [
      {
        id: 'expanded-1',
        keyword: 'Acme scandal',
        sourceType: expandedTargetKeywordSourceType,
        isActive: defaultTargetKeywordIsActive,
        displayOrder: 0,
      },
      {
        id: 'expanded-2',
        keyword: 'Jane Doe Acme',
        sourceType: expandedTargetKeywordSourceType,
        isActive: defaultTargetKeywordIsActive,
        displayOrder: 1,
      },
    ],
    modelVersion: 'gpt-5.4-test',
    generatedAt: '2026-03-30T12:00:00.000Z',
  });

  db.close();
});

test('runMonitoringTargetDiscoveryJob updates an existing profile, replaces expanded keywords, and clears stale review state', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertUser(db, {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertMembership(db, {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    status: 'review_required',
  });
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
  });
  insertKeyword(db, {
    id: 'expanded-old',
    monitoringTargetId: 'target-1',
    keyword: 'Legacy expansion',
    sourceType: expandedTargetKeywordSourceType,
  });
  insertProfile(db, {
    id: 'profile-existing',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    summary: 'Old summary',
    relatedEntities: ['Old entity'],
    aliases: ['Old alias'],
    searchResults: [],
    modelVersion: 'gpt-old',
    generatedAt: '2026-03-29T12:00:00.000Z',
  });
  insertReview(db, {
    id: 'review-existing',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    reviewDecision: 'mismatch',
    reviewedByMembershipId: 'membership-1',
    reviewedAt: '2026-03-30T12:30:00.000Z',
  });

  const discoveryResult = await runMonitoringTargetDiscoveryJob({
    db,
    monitoringTargetId: 'target-1',
    now: () => '2026-03-30T13:00:00.000Z',
    createId: createIdGenerator('expanded-1'),
    searchWeb: async () => [
      {
        title: 'Acme Holdings follow-up',
        url: 'https://search.example.com/acme-follow-up',
      },
    ],
    generateTargetProfile: async () => ({
      summary: 'Updated summary',
      relatedEntities: ['Jane Doe'],
      aliases: ['Acme'],
      expandedKeywords: ['New expansion'],
      modelVersion: 'gpt-new',
    }),
  });

  const savedProfile = db
    .prepare(`
      SELECT id, summary, related_entities_json, aliases_json, model_version, generated_at
      FROM monitoring_target_profile
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');
  const expandedKeywords = db
    .prepare(`
      SELECT id, keyword
      FROM target_keyword
      WHERE monitoring_target_id = ? AND source_type = ?
      ORDER BY display_order
    `)
    .all('target-1', expandedTargetKeywordSourceType)
    .map(normalizeRow);
  const savedReview = db
    .prepare(`
      SELECT id
      FROM monitoring_target_review
      WHERE workspace_id = ? AND monitoring_target_id = ?
    `)
    .get('workspace-1', 'target-1');

  assert.deepEqual(discoveryResult.expandedKeywords, [
    {
      id: 'expanded-1',
      keyword: 'New expansion',
      sourceType: expandedTargetKeywordSourceType,
      isActive: defaultTargetKeywordIsActive,
      displayOrder: 0,
    },
  ]);
  assert.deepEqual(normalizeRow(savedProfile), {
    id: 'profile-existing',
    summary: 'Updated summary',
    related_entities_json: JSON.stringify(['Jane Doe']),
    aliases_json: JSON.stringify(['Acme']),
    model_version: 'gpt-new',
    generated_at: '2026-03-30T13:00:00.000Z',
  });
  assert.deepEqual(expandedKeywords, [
    {
      id: 'expanded-1',
      keyword: 'New expansion',
    },
  ]);
  assert.equal(savedReview, undefined);

  db.close();
});

test('runMonitoringTargetDiscoveryJob rejects unsupported target statuses', async () => {
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
    status: 'active',
  });
  insertKeyword(db, {
    id: 'seed-1',
    monitoringTargetId: 'target-1',
    keyword: 'Acme Holdings',
  });

  await assert.rejects(
    () =>
      runMonitoringTargetDiscoveryJob({
        db,
        monitoringTargetId: 'target-1',
        searchWeb: async () => [],
        generateTargetProfile: async () => ({
          summary: 'Should not run',
          relatedEntities: [],
          aliases: [],
          expandedKeywords: [],
          modelVersion: 'gpt-test',
        }),
      }),
    (error) => {
      assert.ok(error instanceof MonitoringTargetDiscoveryJobError);
      assert.equal(error.code, 'MONITORING_TARGET_STATUS_INVALID');
      return true;
    },
  );

  db.close();
});
