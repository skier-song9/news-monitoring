'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const { createWorkspace } = require('../src/backend/workspace-service.cjs');
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
