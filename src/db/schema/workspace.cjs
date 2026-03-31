'use strict';

const workspaceRoles = ['owner', 'admin', 'member'];
const workspaceAdminRoles = ['owner', 'admin'];
const membershipStatuses = ['active', 'pending', 'suspended'];
const invitationStatuses = ['pending', 'accepted', 'expired', 'revoked'];

module.exports = {
  invitationStatuses,
  membershipStatuses,
  workspaceAdminRoles,
  workspaceRoles,
};
