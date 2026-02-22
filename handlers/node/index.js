'use strict';

const lint = require('./lint');
const test = require('./test');
const build = require('./build');
const dependency = require('./dependency');

// Handler execution order: lint → test → build → dependency
const handlers = [lint, test, build, dependency];

module.exports = { handlers };
