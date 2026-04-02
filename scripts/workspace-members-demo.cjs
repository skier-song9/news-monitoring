'use strict';

const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  createWorkspace,
  inviteTeammate,
} = require('../src/backend/workspace-service.cjs');
const { createWorkspaceMembersApp } = require('../src/http/workspace-members-app.cjs');

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

function seedDemoData(db) {
  insertUser(db, {
    id: 'user-owner',
    email: 'owner@acme.example',
    displayName: 'Morgan Lee',
  });
  insertUser(db, {
    id: 'user-admin',
    email: 'admin@acme.example',
    displayName: 'Dana Park',
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
    createId: (() => {
      const ids = ['workspace-1', 'membership-owner'];
      return () => ids.shift();
    })(),
  });

  insertMembership(db, {
    id: 'membership-admin',
    workspaceId: workspace.id,
    userId: 'user-admin',
    role: 'admin',
  });
  insertMembership(db, {
    id: 'membership-member',
    workspaceId: workspace.id,
    userId: 'user-member',
    role: 'member',
  });

  inviteTeammate({
    db,
    workspaceId: workspace.id,
    invitedByUserId: 'user-owner',
    email: 'analyst@acme.example',
    now: () => '2026-04-02T02:00:00.000Z',
    createId: () => 'invitation-1',
    createToken: () => 'demo-token-1',
  });

  return workspace;
}

const port = Number.parseInt(process.env.PORT ?? '4310', 10);
const db = new DatabaseSync(':memory:');
applyMigrations(db);
const workspace = seedDemoData(db);

const server = createServer(
  createWorkspaceMembersApp({
    db,
    getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
    now: () => '2026-04-02T03:00:00.000Z',
  }),
);

server.listen(port, () => {
  process.stdout.write(`Workspace members demo running on http://127.0.0.1:${port}/workspaces/${workspace.id}/members?userId=user-owner\n`);
  process.stdout.write(`Non-admin demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/members?userId=user-member\n`);
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
