'use strict';


// TODO Convert GitHub users to Slack users
// TODO Show user how much money they have
// TODO Calcuate dynamic reward value
// TODO Allow reviewee to set additional bounty
// TODO Make the regexes accept natural language
// TODO Print summary / leaderboard every Friday
// TODO Print who is reviewing what in the list

let bluebird = require('bluebird');
let handlebars = require('handlebars');
let GitHubApi = require('github');
let mongoose = require('mongoose');
let _ = require('lodash');

let config = {
  GH_TOKEN: process.env.GH_TOKEN,
  REPO_NAME: process.env.REPO_NAME,
  REPO_OWNER: process.env.REPO_OWNER,
  MONGODB_URI: process.env.MONGODB_URI,
  NAME_SERVICE_URL: process.env.NAME_SERVICE_URL,
};

let gh = new GitHubApi({
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  Promise: bluebird,
  timeout: 5000,
});

let prRow = handlebars.compile('<{{ html_url }}|{{ title }} [author: ' +
  '{{ user.login }}, reward: {{ reward }}]>');
let userRow = handlebars.compile('{{ username }}: {{ balance }}');

mongoose.connect(config.MONGODB_URI);

let PersonSchema = new mongoose.Schema({
  reward: Number,
  role: String,
  username: String,
});
let PullRequestSchema = new mongoose.Schema({
  number: Number,
  title: String,
  people: [PersonSchema],
});

let Person = mongoose.model('Person', PersonSchema);
let PullRequest = mongoose.model('PullRequest', PullRequestSchema);

// Program
module.exports = function (robot) {
  let authenticate = function() {
    gh.authenticate({
      type: 'oauth',
      token: config.GH_TOKEN,
    });
  };

  let getReward = function (pr) {
    return 100;
  };

  let getSlackUsername = function (ghUsername, cb) {
    let target = `${config.NAME_SERVICE_URL}/user/reverse/${ghUsername}`;
    let promise = new Promise((resolve, reject) =>
      robot.http(target).get()((err, __, body) => {
        // HACK Extract just the username part
        let name = JSON.parse(body)[0].username.slice(0, -1).split('|')[1];
        return err ? reject(err) : resolve(name);
      }));

    return promise;
  };

  let getScoreboard = function () {
    return PullRequest.aggregate([
      {$unwind: '$people'},
      {$group: {_id: '$people.username', balance: {$sum: '$people.reward'}}},
      {$sort: {balance: -1}},
      {$project: {username: '$_id', balance: '$balance'}},
    ]);
  };

  let getPullRequests = function (cb) {
    authenticate();

    return gh.pullRequests.getAll({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      state: 'open',
      per_page: 10, // TODO Pagination
    });
  };

  let getReviews = function (prNumber) {
    authenticate();

    return gh.pullRequests.getReviews({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      number: prNumber,
      per_page: 100, // TODO Pagination
    });
  };

  let rewardReviewers = function (pullRequest, owner, reviewers) {
    robot.logger.debug('rewardReviewers for ' + pullRequest.title + ' and '
      + JSON.stringify(reviewers));

    if (!reviewers) {
      return;
    }

    let reward = getReward(pullRequest);
    let pr = new PullRequest();
    pr.number = pullRequest.number;
    pr.title = pullRequest.title;
    pr.people = _.map(reviewers, function (reviewer) {
      return new Person({
        username: reviewer,
        reward: reward,
        role: 'REVIEWER'});
    });
    pr.people.push(new Person({
      username: owner,
      reward: -reward,
      role: 'OWNER'})
    );

    pr.save();
  };

  robot.hear(/scoreboard/i, function (res) {
    getScoreboard().exec(function (__, scoreboard) {
      let summary;
      if (scoreboard) {
        summary = _.reduce(scoreboard, function (message, user) {
          return message + userRow(user) + '\n';
        }, '');
      } else {
        summary = 'Nobody is on the scoreboard yet!';
      }
      res.send(summary);
    });
  });

  robot.hear(/PRs need review/i, function (res) {
    getPullRequests().then(function (resp) {
      let summary;
      if (resp.data) {
        summary = _.reduce(resp.data, function (message, pr) {
          pr.reward = getReward(pr);
          return message + prRow(pr) + '\n';
        }, '');
      } else {
        summary = 'No PRs need review currently.';
      }
      res.send(summary);
    });
  });

  robot.router.post('/github-hook', function (req, res) {
    let payload = req.body;
    /* payload.organization != config.REPO_OWNER || */
    if (payload.repository.name != config.REPO_NAME) {
      res.writeHead(400);
    } else {
      res.writeHead(202);

      if (payload.action === 'closed' && payload.pull_request.merged) {
        robot.logger.debug('PR closed');

        getReviews(payload.pull_request.number).then(
          function (reviewsResp) {
            let ghUsernames = _.uniq(_.map(reviewsResp.data, 'user.login'));
            ghUsernames.unshift(payload.pull_request.user.login);

            let lookupNamesInParallel = Promise.all(
              _.map(ghUsernames, (u) => getSlackUsername(u)));

            lookupNamesInParallel.then((slackUsernames) =>
              rewardReviewers(payload.pull_request, slackUsernames.shift(), slackUsernames));
          });
      }
    }
    res.end();
  });
};


