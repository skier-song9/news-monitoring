'use strict';

const monitoringTargetMatchReviewDecision = 'match';
const monitoringTargetPartialMatchReviewDecision = 'partial_match';
const monitoringTargetMismatchReviewDecision = 'mismatch';

const monitoringTargetReviewDecisions = [
  monitoringTargetMatchReviewDecision,
  monitoringTargetPartialMatchReviewDecision,
  monitoringTargetMismatchReviewDecision,
];

module.exports = {
  monitoringTargetMatchReviewDecision,
  monitoringTargetMismatchReviewDecision,
  monitoringTargetPartialMatchReviewDecision,
  monitoringTargetReviewDecisions,
};
