'use strict';

const lowArticleAnalysisRiskBand = 'low';
const mediumArticleAnalysisRiskBand = 'medium';
const highArticleAnalysisRiskBand = 'high';
const articleAnalysisRiskBands = [
  lowArticleAnalysisRiskBand,
  mediumArticleAnalysisRiskBand,
  highArticleAnalysisRiskBand,
];
const articleAnalysisRiskBandRanges = [
  {
    band: lowArticleAnalysisRiskBand,
    minimumScore: 0,
    maximumScore: 39,
  },
  {
    band: mediumArticleAnalysisRiskBand,
    minimumScore: 40,
    maximumScore: 69,
  },
  {
    band: highArticleAnalysisRiskBand,
    minimumScore: 70,
    maximumScore: 100,
  },
];
const keywordArticleAnalysisRelevanceSignalType = 'keyword';
const entityArticleAnalysisRelevanceSignalType = 'entity';
const articleAnalysisRelevanceSignalTypes = [
  keywordArticleAnalysisRelevanceSignalType,
  entityArticleAnalysisRelevanceSignalType,
];
const alertChannels = ['slack', 'email', 'sms'];
const alertEventStatuses = [
  'pending',
  'dispatching',
  'delivered',
  'partially_delivered',
  'failed',
  'suppressed',
];
const alertBatchStatuses = alertEventStatuses.slice();
const alertDeliveryStatuses = ['pending', 'sent', 'failed', 'skipped'];
const alertPolicyDefaultThreshold = 70;

function getArticleAnalysisRiskBand(riskScore) {
  if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) {
    throw new RangeError('riskScore must be an integer between 0 and 100');
  }

  const matchingRange = articleAnalysisRiskBandRanges.find(
    ({ minimumScore, maximumScore }) => riskScore >= minimumScore && riskScore <= maximumScore,
  );

  if (!matchingRange) {
    throw new RangeError(`No risk band found for riskScore: ${riskScore}`);
  }

  return matchingRange.band;
}

module.exports = {
  alertBatchStatuses,
  alertChannels,
  alertDeliveryStatuses,
  alertEventStatuses,
  alertPolicyDefaultThreshold,
  articleAnalysisRelevanceSignalTypes,
  articleAnalysisRiskBandRanges,
  articleAnalysisRiskBands,
  entityArticleAnalysisRelevanceSignalType,
  getArticleAnalysisRiskBand,
  highArticleAnalysisRiskBand,
  keywordArticleAnalysisRelevanceSignalType,
  lowArticleAnalysisRiskBand,
  mediumArticleAnalysisRiskBand,
};
