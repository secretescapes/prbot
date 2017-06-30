'use strict';

let handlebars = require('handlebars');
let GitHubApi = require('github');
let bluebird = require('bluebird');

let gh = new GitHubApi({
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  Promise: bluebird,
  timeout: 5000,
});

// Templates
let tableRow = handlebars.compile('<{{ html_url }}|{{ title }} [author: ' +
  '{{ author.login }}, reward: {{ reward }}]>');

// Configuration
let config = {
  GH_TOKEN: process.env.GH_TOKEN,
  REPO_NAME: process.env.REPO_NAME,
  REPO_OWNER: process.env.REPO_OWNER,
};

// Program
module.exports = function (robot) {
  let authenticate = function() {
    gh.authenticate({
      type: 'oauth',
      token: config.GH_TOKEN,
    });
  };

  let reward = function(pr) {
    return 100;
  };

  robot.hear(/I want a PR for (\d+)/i, function(res) {
    // TODO
  });

  robot.hear(/what PRs need review/i, function(res) {
    authenticate();
    gh.pullRequests.getAll({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      state: 'open',
      sort: 'long-running',
      direction: 'desc',
      per_page: 10,
    }).then(function(resp) {
      let output = '';
      resp.data.forEach(function(pr) {
          pr.reward = reward(pr);
          output += tableRow(pr) + '\n';
      });
      robot.reply(output);
    });
  });
};
