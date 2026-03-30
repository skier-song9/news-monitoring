'use strict';

const workspaceRoles = ['owner', 'admin', 'member'];
const membershipStatuses = ['active', 'pending', 'suspended'];
const invitationStatuses = ['pending', 'accepted', 'expired', 'revoked'];

module.exports = {
  invitationStatuses,
  membershipStatuses,
  workspaceRoles,
};
