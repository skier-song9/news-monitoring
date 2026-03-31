'use strict';

const defaultMonitoringTargetStatus = 'review_required';
const monitoringTargetProfileInProgressStatus = 'profile_in_progress';
const monitoringTargetReadyForReviewStatus = 'ready_for_review';
const monitoringTargetAwaitingActivationStatus = 'awaiting_activation';
const activeMonitoringTargetStatus = 'active';
const pausedMonitoringTargetStatus = 'paused';
const archivedMonitoringTargetStatus = 'archived';

const monitoringTargetStatuses = [
  defaultMonitoringTargetStatus,
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
  monitoringTargetAwaitingActivationStatus,
  activeMonitoringTargetStatus,
  pausedMonitoringTargetStatus,
  archivedMonitoringTargetStatus,
];

const monitoringTargetTypes = ['company', 'person'];
const defaultMonitoringTargetRiskThreshold = 70;

module.exports = {
  activeMonitoringTargetStatus,
  archivedMonitoringTargetStatus,
  defaultMonitoringTargetRiskThreshold,
  defaultMonitoringTargetStatus,
  monitoringTargetAwaitingActivationStatus,
  monitoringTargetProfileInProgressStatus,
  monitoringTargetReadyForReviewStatus,
  monitoringTargetStatuses,
  monitoringTargetTypes,
  pausedMonitoringTargetStatus,
};
