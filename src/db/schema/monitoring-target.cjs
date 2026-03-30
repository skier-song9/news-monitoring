'use strict';

const defaultMonitoringTargetStatus = 'review_required';
const monitoringTargetProfileInProgressStatus = 'profile_in_progress';
const monitoringTargetReadyForReviewStatus = 'ready_for_review';

const monitoringTargetStatuses = [
  defaultMonitoringTargetStatus,
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
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
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
  monitoringTargetStatuses,
  monitoringTargetTypes,
};
