'use strict';

const monitoringTargetStatuses = [
  'review_required',
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
  monitoringTargetStatuses,
  monitoringTargetTypes,
};
