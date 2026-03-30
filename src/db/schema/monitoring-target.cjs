'use strict';

const defaultMonitoringTargetStatus = 'review_required';

const monitoringTargetStatuses = [
  defaultMonitoringTargetStatus,
  'profile_in_progress',
  'ready_for_review',
  'awaiting_activation',
  'active',
  'paused',
  'archived',
];

const monitoringTargetTypes = ['company', 'person'];
const defaultMonitoringTargetRiskThreshold = 70;

module.exports = {
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetStatuses,
  monitoringTargetTypes,
};
