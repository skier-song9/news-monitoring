'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  WorkspaceServiceError,
  acceptInvitation,
  createWorkspace,
  inviteTeammate,
} = require('../src/backend/workspace-service.cjs');

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

test('createWorkspace creates the workspace and an owner membership', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'ACME-RISK',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('workspace-1', 'membership-1'),
  });

  const savedWorkspace = db
    .prepare('SELECT id, slug, name FROM workspace WHERE id = ?')
    .get('workspace-1');
  const savedMembership = db
    .prepare('SELECT id, workspace_id, user_id, role, status FROM workspace_membership WHERE id = ?')
    .get('membership-1');

  assert.deepEqual(workspace, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
    ownerMembershipId: 'membership-1',
    ownerUserId: 'user-owner',
  });
  assert.deepEqual(normalizeRow(savedWorkspace), {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  assert.deepEqual(normalizeRow(savedMembership), {
    id: 'membership-1',
    workspace_id: 'workspace-1',
    user_id: 'user-owner',
    role: 'owner',
    status: 'active',
  });

  db.close();
});

test('inviteTeammate allows admins and rejects non-admin workspace members', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertUser(db, {
    id: 'user-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
  });
  insertUser(db, {
    id: 'user-member',
    email: 'member@example.com',
    displayName: 'Member',
  });

  createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  insertMembership(db, {
    id: 'membership-admin',
    workspaceId: 'workspace-1',
    userId: 'user-admin',
    role: 'admin',
  });
  insertMembership(db, {
    id: 'membership-member',
    workspaceId: 'workspace-1',
    userId: 'user-member',
    role: 'member',
  });

  const invitation = inviteTeammate({
    db,
    workspaceId: 'workspace-1',
    invitedByUserId: 'user-admin',
    email: 'Teammate@Example.com',
    role: 'member',
    expiresAt: '2026-04-06T12:00:00.000Z',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: () => 'invitation-1',
    createToken: () => 'token-1',
  });

  const savedInvitation = db
    .prepare(`
      SELECT id, workspace_id, email, role, status, token, invited_by_membership_id, expires_at
      FROM workspace_invitation
      WHERE id = ?
    `)
    .get('invitation-1');

  assert.deepEqual(invitation, {
    id: 'invitation-1',
    workspaceId: 'workspace-1',
    email: 'teammate@example.com',
    role: 'member',
    status: 'pending',
    token: 'token-1',
    invitedByMembershipId: 'membership-admin',
    expiresAt: '2026-04-06T12:00:00.000Z',
  });
  assert.deepEqual(normalizeRow(savedInvitation), {
    id: 'invitation-1',
    workspace_id: 'workspace-1',
    email: 'teammate@example.com',
    role: 'member',
    status: 'pending',
    token: 'token-1',
    invited_by_membership_id: 'membership-admin',
    expires_at: '2026-04-06T12:00:00.000Z',
  });

  assert.throws(
    () =>
      inviteTeammate({
        db,
        workspaceId: 'workspace-1',
        invitedByUserId: 'user-member',
        email: 'another@example.com',
      }),
    (error) => {
      assert.ok(error instanceof WorkspaceServiceError);
      assert.equal(error.code, 'WORKSPACE_INVITER_FORBIDDEN');
      return true;
    },
  );

  db.close();
});

test('acceptInvitation creates a membership in the invitation workspace and marks the invitation accepted', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertUser(db, {
    id: 'user-invitee',
    email: 'invitee@example.com',
    displayName: 'Invitee',
  });

  createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  inviteTeammate({
    db,
    workspaceId: 'workspace-1',
    invitedByUserId: 'user-owner',
    email: 'Invitee@example.com',
    role: 'admin',
    expiresAt: '2026-04-06T12:00:00.000Z',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: () => 'invitation-1',
    createToken: () => 'token-accept',
  });

  const acceptance = acceptInvitation({
    db,
    token: 'token-accept',
    userId: 'user-invitee',
    now: () => '2026-03-31T09:00:00.000Z',
    createId: () => 'membership-accepted',
  });

  const acceptedMembership = db
    .prepare(`
      SELECT id, workspace_id, user_id, role, status
      FROM workspace_membership
      WHERE id = ?
    `)
    .get('membership-accepted');
  const acceptedInvitation = db
    .prepare(`
      SELECT status, accepted_membership_id, responded_at
      FROM workspace_invitation
      WHERE id = ?
    `)
    .get('invitation-1');

  assert.deepEqual(acceptance, {
    membershipId: 'membership-accepted',
    workspaceId: 'workspace-1',
    userId: 'user-invitee',
    role: 'admin',
    status: 'active',
    acceptedInvitationId: 'invitation-1',
  });
  assert.deepEqual(normalizeRow(acceptedMembership), {
    id: 'membership-accepted',
    workspace_id: 'workspace-1',
    user_id: 'user-invitee',
    role: 'admin',
    status: 'active',
  });
  assert.deepEqual(normalizeRow(acceptedInvitation), {
    status: 'accepted',
    accepted_membership_id: 'membership-accepted',
    responded_at: '2026-03-31T09:00:00.000Z',
  });

  db.close();
});

test('acceptInvitation rejects users whose email does not match the invitation recipient', () => {
  const db = createDatabase();

  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertUser(db, {
    id: 'user-other',
    email: 'other@example.com',
    displayName: 'Other User',
  });

  createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  inviteTeammate({
    db,
    workspaceId: 'workspace-1',
    invitedByUserId: 'user-owner',
    email: 'invitee@example.com',
    expiresAt: '2026-04-06T12:00:00.000Z',
    createId: () => 'invitation-1',
    createToken: () => 'token-mismatch',
  });

  assert.throws(
    () =>
      acceptInvitation({
        db,
        token: 'token-mismatch',
        userId: 'user-other',
      }),
    (error) => {
      assert.ok(error instanceof WorkspaceServiceError);
      assert.equal(error.code, 'WORKSPACE_INVITATION_EMAIL_MISMATCH');
      return true;
    },
  );

  db.close();
});
