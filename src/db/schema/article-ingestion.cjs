'use strict';

const articleCandidateIngestionStatuses = ['pending', 'processing', 'linked', 'failed', 'discarded'];
const articleIngestionStatuses = ['pending', 'processing', 'completed', 'failed'];

module.exports = {
  articleCandidateIngestionStatuses,
  articleIngestionStatuses,
};
