'use strict';


// TODO Convert GitHub users to Slack users
// TODO Show user how much money they have
// TODO Calcuate dynamic reward value
// TODO Allow reviewee to set additional bounty
// TODO Make the regexes accept natural language
// TODO Leaderboard
// TODO Print summary / leaderboard every Friday
// TODO Print who is reviewing what in the list

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

mongoose.connect(config.MONGODB_URI);

let Review = mongoose.model('Review', {
  reward: {type: Number},
  reviewee: {type: String},
  reviewer: {type: String},
});

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

  robot.router.post("/github-hook", function (req, res) {
    let payload = req.body;
    if (/*payload.organization != config.REPO_OWNER || */payload.repository.name != config.REPO_NAME) {
      res.writeHead(400);
    } else {
      res.writeHead(202);

      if (payload.action === 'closed' && payload.pull_request.merged) {
        robot.logger.debug("PR closed")
        authenticate();


        gh.pullRequests.getReviews({
          repo: config.REPO_NAME,
          owner: config.REPO_OWNER,
          number: payload.pull_request.number,
          per_page: 100, // TODO Pagination
        }).then(resp => rewardReviewers(payload.pull_request, _.uniq(_.map(resp.data, 'user.login'))));
      }
    }
    res.end();
  });
  function rewardReviewers (pullRequest, reviewers) {
  robot.logger.debug('rewardReviewers for ' + pullRequest.title + ' and ' + reviewers);
  var reward = getReward(pullRequest);

  Review.insertMany(_.map(reviewers, function (reviewer) {
    // TODO reviewee != reviewer
    return {
      reward: reward,
      reviewee: pullRequest.user.login,
      reviewer: reviewer,
    };
  }));
}
};


