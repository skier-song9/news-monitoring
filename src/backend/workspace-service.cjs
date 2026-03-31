'use strict';

const { randomBytes, randomUUID } = require('node:crypto');

const {
  workspaceAdminRoles,
  workspaceRoles,
} = require('../db/schema/workspace.cjs');

const ACTIVE_MEMBERSHIP_STATUS = 'active';
const PENDING_INVITATION_STATUS = 'pending';
const ACCEPTED_INVITATION_STATUS = 'accepted';
const DEFAULT_INVITATION_TTL_DAYS = 7;

class WorkspaceServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceServiceError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new WorkspaceServiceError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new WorkspaceServiceError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeEmail(email) {
  return normalizeRequiredString(email, 'email').toLowerCase();
}

function normalizeWorkspaceSlug(workspaceSlug) {
  return normalizeRequiredString(workspaceSlug, 'workspaceSlug').toLowerCase();
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultCreateId() {
  return randomUUID();
}

function defaultCreateToken() {
  return randomBytes(24).toString('hex');
}

function defaultInvitationExpiry(nowTimestamp) {
  const expirationDate = new Date(nowTimestamp);
  expirationDate.setUTCDate(expirationDate.getUTCDate() + DEFAULT_INVITATION_TTL_DAYS);
  return expirationDate.toISOString();
}

function toTimestamp(value, fieldName) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new WorkspaceServiceError('INVALID_INPUT', `${fieldName} must be a valid timestamp`);
  }

  return timestamp;
}

function runInTransaction(db, callback) {
  db.exec('BEGIN');

  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures because the original error is the actionable one.
    }

    throw error;
  }
}

function getUserAccount(db, userId) {
  return db
    .prepare(`
      SELECT id, email, display_name
      FROM user_account
      WHERE id = ?
    `)
    .get(userId);
}

function getMembershipByWorkspaceAndUser(db, workspaceId, userId) {
  return db
    .prepare(`
      SELECT id, workspace_id, user_id, role, status
      FROM workspace_membership
      WHERE workspace_id = ? AND user_id = ?
    `)
    .get(workspaceId, userId);
}

function getMembershipByWorkspaceAndEmail(db, workspaceId, email) {
  return db
    .prepare(`
      SELECT workspace_membership.id
      FROM workspace_membership
      INNER JOIN user_account
        ON user_account.id = workspace_membership.user_id
      WHERE workspace_membership.workspace_id = ?
        AND LOWER(user_account.email) = LOWER(?)
    `)
    .get(workspaceId, email);
}

function getInvitationByWorkspaceAndEmail(db, workspaceId, email) {
  return db
    .prepare(`
      SELECT id, status
      FROM workspace_invitation
      WHERE workspace_id = ?
        AND LOWER(email) = LOWER(?)
    `)
    .get(workspaceId, email);
}

function createWorkspace({
  db,
  ownerUserId,
  workspaceName,
  workspaceSlug,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const normalizedOwnerUserId = normalizeRequiredString(ownerUserId, 'ownerUserId');
  const normalizedWorkspaceName = normalizeRequiredString(workspaceName, 'workspaceName');
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);

  const ownerUser = getUserAccount(db, normalizedOwnerUserId);

  if (!ownerUser) {
    throw new WorkspaceServiceError('USER_ACCOUNT_NOT_FOUND', 'Owner user account does not exist');
  }

  return runInTransaction(db, () => {
    const createdAt = now();
    const workspaceId = createId();
    const ownerMembershipId = createId();

    db.prepare(`
      INSERT INTO workspace (id, slug, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspaceId, normalizedWorkspaceSlug, normalizedWorkspaceName, createdAt, createdAt);

    db.prepare(`
      INSERT INTO workspace_membership (id, workspace_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', ?, ?, ?)
    `).run(
      ownerMembershipId,
      workspaceId,
      normalizedOwnerUserId,
      ACTIVE_MEMBERSHIP_STATUS,
      createdAt,
      createdAt,
    );

    return {
      id: workspaceId,
      slug: normalizedWorkspaceSlug,
      name: normalizedWorkspaceName,
      ownerMembershipId,
      ownerUserId: ownerUser.id,
    };
  });
}

function inviteTeammate({
  db,
  workspaceId,
  invitedByUserId,
  email,
  role = 'member',
  expiresAt,
  now = defaultNow,
  createId = defaultCreateId,
  createToken = defaultCreateToken,
}) {
  const normalizedWorkspaceId = normalizeRequiredString(workspaceId, 'workspaceId');
  const normalizedInvitedByUserId = normalizeRequiredString(invitedByUserId, 'invitedByUserId');
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = normalizeRequiredString(role, 'role');

  if (!workspaceRoles.includes(normalizedRole)) {
    throw new WorkspaceServiceError('INVALID_INPUT', `role must be one of: ${workspaceRoles.join(', ')}`);
  }

  const inviterMembership = getMembershipByWorkspaceAndUser(
    db,
    normalizedWorkspaceId,
    normalizedInvitedByUserId,
  );

  if (
    !inviterMembership ||
    inviterMembership.status !== ACTIVE_MEMBERSHIP_STATUS ||
    !workspaceAdminRoles.includes(inviterMembership.role)
  ) {
    throw new WorkspaceServiceError(
      'WORKSPACE_INVITER_FORBIDDEN',
      'Only active workspace admins can create invitations',
    );
  }

  if (getMembershipByWorkspaceAndEmail(db, normalizedWorkspaceId, normalizedEmail)) {
    throw new WorkspaceServiceError(
      'WORKSPACE_MEMBER_ALREADY_EXISTS',
      'The invited email already belongs to a workspace member',
    );
  }

  const existingInvitation = getInvitationByWorkspaceAndEmail(db, normalizedWorkspaceId, normalizedEmail);

  if (existingInvitation) {
    throw new WorkspaceServiceError(
      'WORKSPACE_INVITATION_EXISTS',
      'An invitation already exists for that email in the workspace',
    );
  }

  const createdAt = now();
  const invitationExpiry = expiresAt ?? defaultInvitationExpiry(createdAt);
  toTimestamp(invitationExpiry, 'expiresAt');
  const invitationId = createId();
  const invitationToken = createToken();

  db.prepare(`
    INSERT INTO workspace_invitation (
      id,
      workspace_id,
      email,
      role,
      status,
      token,
      invited_by_membership_id,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invitationId,
    normalizedWorkspaceId,
    normalizedEmail,
    normalizedRole,
    PENDING_INVITATION_STATUS,
    invitationToken,
    inviterMembership.id,
    invitationExpiry,
    createdAt,
    createdAt,
  );

  return {
    id: invitationId,
    workspaceId: normalizedWorkspaceId,
    email: normalizedEmail,
    role: normalizedRole,
    status: PENDING_INVITATION_STATUS,
    token: invitationToken,
    invitedByMembershipId: inviterMembership.id,
    expiresAt: invitationExpiry,
  };
}

function acceptInvitation({
  db,
  token,
  userId,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const normalizedToken = normalizeRequiredString(token, 'token');
  const normalizedUserId = normalizeRequiredString(userId, 'userId');

  const invitation = db
    .prepare(`
      SELECT
        id,
        workspace_id,
        email,
        role,
        status,
        expires_at
      FROM workspace_invitation
      WHERE token = ?
    `)
    .get(normalizedToken);

  if (!invitation) {
    throw new WorkspaceServiceError('WORKSPACE_INVITATION_NOT_FOUND', 'Invitation token was not found');
  }

  if (invitation.status !== PENDING_INVITATION_STATUS) {
    throw new WorkspaceServiceError(
      'WORKSPACE_INVITATION_NOT_PENDING',
      'Only pending invitations can be accepted',
    );
  }

  const userAccount = getUserAccount(db, normalizedUserId);

  if (!userAccount) {
    throw new WorkspaceServiceError('USER_ACCOUNT_NOT_FOUND', 'User account does not exist');
  }

  if (normalizeEmail(userAccount.email) !== normalizeEmail(invitation.email)) {
    throw new WorkspaceServiceError(
      'WORKSPACE_INVITATION_EMAIL_MISMATCH',
      'Invitation email does not match the accepting user account',
    );
  }

  const acceptedAt = now();

  if (toTimestamp(invitation.expires_at, 'invitation.expires_at') <= toTimestamp(acceptedAt, 'now')) {
    throw new WorkspaceServiceError(
      'WORKSPACE_INVITATION_EXPIRED',
      'Invitation has expired and can no longer be accepted',
    );
  }

  if (getMembershipByWorkspaceAndUser(db, invitation.workspace_id, normalizedUserId)) {
    throw new WorkspaceServiceError(
      'WORKSPACE_MEMBER_ALREADY_EXISTS',
      'The user is already a member of the workspace',
    );
  }

  return runInTransaction(db, () => {
    const membershipId = createId();

    db.prepare(`
      INSERT INTO workspace_membership (id, workspace_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      membershipId,
      invitation.workspace_id,
      normalizedUserId,
      invitation.role,
      ACTIVE_MEMBERSHIP_STATUS,
      acceptedAt,
      acceptedAt,
    );

    db.prepare(`
      UPDATE workspace_invitation
      SET status = ?,
          accepted_membership_id = ?,
          responded_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      ACCEPTED_INVITATION_STATUS,
      membershipId,
      acceptedAt,
      acceptedAt,
      invitation.id,
    );

    return {
      membershipId,
      workspaceId: invitation.workspace_id,
      userId: normalizedUserId,
      role: invitation.role,
      status: ACTIVE_MEMBERSHIP_STATUS,
      acceptedInvitationId: invitation.id,
    };
  });
}

module.exports = {
  DEFAULT_INVITATION_TTL_DAYS,
  WorkspaceServiceError,
  acceptInvitation,
  createWorkspace,
  inviteTeammate,
};
