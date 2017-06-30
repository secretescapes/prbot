'use strict';

let handlebars = require('handlebars');
let GitHubApi = require('github');
let bluebird = require('bluebird');
let mongoose = require('mongoose');
let _ = require('lodash');

let config = {
  GH_TOKEN: process.env.GH_TOKEN,
  REPO_NAME: process.env.REPO_NAME,
  REPO_OWNER: process.env.REPO_OWNER,
  MONGODB_URI: process.env.MONGODB_URI,
};

let gh = new GitHubApi({
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  Promise: bluebird,
  timeout: 5000,
});

let tableRow = handlebars.compile('<{{ html_url }}|{{ title }} [author: ' +
    '{{ user.login }}, reward: {{ reward }}]>');

let Review = mongoose.model('Review', {
  reward: {type: Number},
  reviewee: {type: String},
  reviewer: {type: String},
});

mongoose.connect(config.MONGODB_URL);

// Program
module.exports = function (robot) {
  let authenticate = function() {
    gh.authenticate({
      type: 'oauth',
      token: config.GH_TOKEN,
    });
  };

  let getReward = function(pr) {
    return 100;
  };

  robot.hear(/I want a PR for (\d+)/i, function (res) {
    // TODO
  });

  robot.hear(/what PRs need review/i, function (res) {
    authenticate();

    gh.pullRequests.getAll({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      state: 'open',
      per_page: 10, // TODO Pagination
    }).then(function (resp) {
      let output = '';
      resp.data.forEach(function (pr) {
        pr.reward = getReward(pr);
        output += tableRow(pr) + '\n';
      });
      res.send(output);
    });
  });

  robot.router.get("/github-hook", function (req, res) {
    let payload = req.body.payload;
    if (payload.organization != config.REPO_OWNER || payload.repository != config.REPO_NAME) {
      return; // Ignore
    }

    if (payload.action === 'closed' && payload.merged) {
      authenticate();

      gh.pullRequests.getReviews({
        repo: config.REPO_NAME,
        owner: config.REPO_OWNER,
        number: payload.pull_request.id,
        per_page: 100, // TODO Pagination
      }).then(function (resp) {
        var reward = getReward(payload.pull_request);
        var people = _.uniq(_.map(resp.data, 'user.login'));

        people.forEach(function (user) {
          let r = new Review();
          r.reward = reward;
          r.reviewee = payload.pull_request.user.login;
          r.reviewer = user;
        });
      });
    }
  });
};
