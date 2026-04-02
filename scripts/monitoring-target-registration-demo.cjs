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

const port = Number.parseInt(process.env.PORT ?? '4311', 10);
const db = new DatabaseSync(':memory:');
applyMigrations(db);
const workspace = seedDemoData(db);

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
    server.listen(port, () => {
      process.stdout.write(`Target registration demo running on http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-owner\n`);
      process.stdout.write(`Member demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-member\n`);
      process.stdout.write(`Review demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/${target.id}/review?userId=user-owner\n`);
      process.stdout.write(`Alert settings demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/alerts?userId=user-owner\n`);
    });
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    db.close();
    process.exit(1);
  });

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
