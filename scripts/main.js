'use strict';

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
  ROOM_NAME: process.env.ROOM_NAME,
};

let gh = new GitHubApi({
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  Promise: bluebird,
  timeout: 5000,
});

let prRow = handlebars.compile('<{{ html_url }}|{{ title }} [author: ' +
  '{{ user.login }}]>');
let userRow = handlebars.compile('{{ username }}: {{ balance }}');

mongoose.connect(config.MONGODB_URI);

let AchievementType = {
  STREAK_3: 1,
  STREAK_5: 2,
  STREAK_10: 3,
  HUGE_PR: 4,
  MANY_IN_A_DAY: 5,
  TOTAL_PRS_1: 6,
  TOTAL_PRS_10: 7,
  TOTAL_PRS_25: 8,
  TOTAL_PRS_50: 9,
  TOTAL_PRS_100: 10,
  NO_COMMENTS: 11,
  MERGED_MANY_IN_A_DAY: 12,
  MANY_COMMENTS: 13,
  MANY_COMMITS: 14,
};

let AchievementSchema = new mongoose.Schema({
  type: Number,
  name: String,
  description: String,
  ts: {type: Date, default: Date.now},
});
let PersonSchema = new mongoose.Schema({
  reward: Number,
  role: String,
  username: String,
  achievements: [AchievementSchema],
});
let PullRequestSchema = new mongoose.Schema({
  number: Number,
  title: String,
  people: [PersonSchema],
  ts: {type: Date, default: Date.now},
});

let Achievement = mongoose.model('Achievement', AchievementSchema);
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

  let getReward = function (pr, owner, reviewer) {
    let wasQuick = new Date(pr.merged_at) - new Date(pr.created_at) < 86400000;
    let wasRequested = extractUsernames(pr.requested_reviewers).
      includes(reviewer);
    let wasBig = extractPullRequestSize(pr) > 500;

    return 100 + (wasQuick * 50) + (wasRequested * 20) - (wasBig * 60);
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

  let extractUsernames = function (arr) {
    return _.uniq(_.map(arr, 'user.login'));
  };

  let extractPullRequestSize = function (pr) {
    return pr.additions + pr.deletions;
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

  let giveAchievementIdempotent = function (person, achievementType) {
    if (_.some(person.achievements, (a) => a.type === achievementType)) {
      return; // Already has the achievement
    }

    let name;
    let message;
    switch (achievementType) {
      case AchievementType.STREAK_3:
        name = 'Teamwork';
        message = 'Review the same person\'s PRs three times consecutively';
      case AchievementType.STREAK_5:
        name = 'Best of Friends';
        message = 'Review the same person\'s PRs five times consecutively';
      case AchievementType.STREAK_10:
        name = 'Get a Room';
        message = 'Review the same person\'s PRs ten times consecutively';
      case AchievementType.HUGE_PR:
        name = 'Looks Good to Me';
        message = 'Review a 3000+ line PR';
      case AchievementType.MANY_IN_A_DAY:
        name = 'Time for Some Coffee';
        message = 'Review 3 PRs in a day';
      case AchievementType.TOTAL_PRS_1:
        name = 'Welcome to Secret Escapes';
        message = 'Review your first PR';
      case AchievementType.TOTAL_PRS_10:
        name = 'Reviewer';
        message = 'Review 10 PRs in total';
      case AchievementType.TOTAL_PRS_25:
        name = 'Tactical Nuke Incoming!';
        message = 'Review 25 PRs in total';
      case AchievementType.TOTAL_PRS_50:
        name = 'Eat, Sleep, Code, Repeat';
        message = 'Review 50 PRs in total';
      case AchievementType.TOTAL_PRS_100:
        name = 'Veteran';
        message = 'Review 100 PRs in total';
      case AchievementType.NO_COMMENTS:
        name = 'Tumbleweed';
        message = 'Get a PR approved and merged without any comments';
      case AchievementType.MERGED_MANY_IN_A_DAY:
        name = 'Oink Oink';
        message = 'Merge 3 PRs in a day';
      case AchievementType.MANY_COMMENTS:
        name = 'Just One More Thing';
        message = 'Merge a PR which had 10 or more comments';
      case AchievementType.MANY_COMMITS:
        name = 'Marathon';
        message = 'Merge a PR which had 100 or more commits';
      default:
        throw new Exception('Unknown type');
    }

    let a = new Achievement({
      type: achievementType,
      name: name,
      message: message,
    });

    person.achievements.push(a);
    person.save();

    robot.messageRoom(config.ROOM_NAME, person.username +
      ' just got the achievement ' + a.name + '! (' + a.message + ')');
  };

  let rewardReviewers = function (pullRequest, owner, reviewers) {
    robot.logger.debug('rewardReviewers for ' + pullRequest.title + ' and '
      + JSON.stringify(reviewers));

    if (!reviewers) {
      return;
    }

    logPullRequest(pullRequest, owner, reviewers);
    awardAchievements(pullRequest, owner, reviewers);
  };

  let logPullRequest = function (pullRequest, owner, reviewers) {
    let pr = new PullRequest();

    // let lookupNamesInParallel = Promise.all(
    //   _.map(ghUsernames, (u) => getSlackUsername(u)));

    pr.number = pullRequest.number;
    pr.title = pullRequest.title;

    // Give the rewards to all reviewers
    let rewards = _.map(reviewers, function (reviewer) {
      return getReward(pullRequest, owner, reviewer);
    });

    let i = 0;
    pr.people = _.map(reviewers, function (reviewer) {
      i++;
      return new Person({
        username: reviewer,
        reward: getReward(pullRequest, rewards[i], reviewer),
        role: 'REVIEWER',
      });
    });

    pr.people.push(new Person({
      username: owner,
      reward: -_.sum(rewards),
      role: 'OWNER',
    }));

    pr.save();
  };

  let awardAchievements = function (pullRequest, owner, reviewers) {
    // 1: Check for consecutive PRs
    let ownersPullRequests =
      PullRequest.find({'people.role': 'OWNER', 'people.username': owner})
      .sort({'ts': -1}).limit(10);
    let tally = _.map(reviewers, (reviewer) => {
      return {username: reviewer, score: 0, finished: false};
    });

    console.log('pullRequest ' + JSON.stringify(pullRequest));
    console.log('ownersPullRequests ' + JSON.stringify(ownersPullRequests));
    console.log('tally ' + JSON.stringify(tally));

    // Step through each PR in sequence...
    _.each(ownersPullRequests, function (oldPr) {
      // and update the 'concurrent reviews count' for each reviewer
      _.each(tally, function (t) {
        if (!t.finished) {
          let wasReviewer = _.some(oldPr.people, function (p) {
            return p.username === t.username && p.role === 'REVIEWER';
          });

          if (wasReviewer) {
            t.score += wasReviewer;
          } else {
            t.finished = true; // Sequence was broken; stop counting
          }
        }
      });
    });

    console.log('tally after' + JSON.stringify(tally));

    _.each(tally, function (t) {
      if ([3, 5, 10].contains(t.score)) {
        let person = Person.find({'username': t.username});
        giveAchievementIdempotent(person, AchievementType['STREAK_' + t.score]);
      }
    });

    // 2: Check for huge PR
    if (extractPullRequestSize(pullRequest) >= 3000) {
      giveAchievementIdempotent(person, AchievementType.HUGE_PR);
    }

    // 3: Check for multiple PRs in one day
    let today = new Date();
    let tomorrow = new Date();
    today.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    let counts = PullRequest.aggregate([
      {$filter: {
        'people.role': 'REVIEWER',
        'people.username': {$in: reviewers},
        'ts': {$gte: today, $lte: tomorrow}},
      },
      {$unwind: '$people'},
      {$group: {_id: '$people.username', count: {$sum: 1}}},
    ]);

    _.each(counts, function (c) {
      if (c.count > 3) {
        let person = Person.find({'username': c._id});
        giveAchievementIdempotent(person, AchievementType.MANY_IN_A_DAY);
      }
    });

    // 4: Review many PRs in history
    let counts2 = PullRequest.aggregate([
      {$filter: {'people.role': 'REVIEWER', 'people.username': {$in: reviewers}}},
      {$unwind: '$people'},
      {$group: {_id: '$people.username', count: {$sum: 1}}},
    ]);

    _.each(counts2, function (c) {
      if ([1, 10, 25, 50, 100].contains(c.count)) {
        let person = Person.find({'username': c._id});
        giveAchievementIdempotent(person, AchievementType['TOTAL_PRS_' + c.count]);
      }
    });

    // 5: PRs merged without any comment or review
    let numComments = pullRequest.comments + pullRequest.review_comments;
    if (numComments === 0) {
      let person = Person.find({'username': owner});
      giveAchievementIdempotent(person, AchievementType.NO_COMMENTS);
    } else if (numComments >= 10) {
      let person = Person.find({'username': owner});
      giveAchievementIdempotent(person, AchievementType.MANY_COMMENTS);
    }

    // 6: merged several reviews in a day
    let ownerMergedToday = PullRequest.aggregate([
      {$filter: {
        'people.role': 'OWNER',
        'people.username': owner,
        'ts': {$gte: today, $lte: tomorrow}},
      },
      {$unwind: '$people'},
      {$group: {_id: '$people.username', count: {$sum: 1}}},
    ]);

    if (ownerMergedToday.length >= 3) {
      let person = Person.find({'username': owner});
      giveAchievementIdempotent(person, AchievementType.MERGED_MANY_IN_A_DAY);
    }

    // Many commits
    if (pullRequest.commits >= 100) {
      let person = Person.find({'username': owner});
      giveAchievementIdempotent(person, AchievementType.MANY_COMMITS);
    }
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
            let owner = payload.pull_request.user.login;
            let ghReviewers = _.without(extractUsernames(reviewsResp.data),
              owner);

            rewardReviewers(payload.pull_request, owner, ghReviewers);
          });
      }
    }
    res.end();
  });
};


