'use strict';

const articleCandidateIngestionStatuses = ['pending', 'processing', 'linked', 'failed', 'discarded'];
const articleIngestionStatuses = ['pending', 'processing', 'completed', 'failed'];
const articleCandidatePortalNames = ['naver', 'nate', 'google_news'];

const defaultArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[0];
const processingArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[1];
const linkedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[2];
const failedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[3];
const discardedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[4];

module.exports = {
  articleCandidatePortalNames,
  articleCandidateIngestionStatuses,
  articleIngestionStatuses,
  defaultArticleCandidateIngestionStatus,
  discardedArticleCandidateIngestionStatus,
  failedArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
  processingArticleCandidateIngestionStatus,
};
