handlebars = require('handlebars')
GitHubApi = require('github')
bluebird = require('bluebird')

gh = new GitHubApi({
  debug: false,
  protocol: 'https',
  host: 'api.github.com',
  Promise: bluebird,
  timeout: 5000,
})

# Templates
tableRow = handlebars.compile('<{{ pr.html_url }}|{{ pr.head.label }}> ' +
                              '(+{{ pr.additions }} / -{{ pr.deletions }})')

# Configuration
config = {
  GH_TOKEN: process.env.GH_TOKEN,
  REPO_NAME: process.env.REPO_NAME,
  REPO_OWNER: process.env.REPO_OWNER,
}

# Program
module.exports = (robot) ->
  authenticate = ->
    gh.authenticate({
      type: 'oauth',
      token: config.GH_TOKEN,
    })

  robot.hear /I want a PR for (\d+)/i, (res) ->
    # TODO

  robot.hear /what PRs need review/i, (res) ->
    # TODO Use pagination to find all PRs
    authenticate()
    gh.pullRequests.getAll({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      state: 'open',
      sort: 'long-running',
      direction: 'desc',
      per_page: 10,
    }).then((resp) ->
      res.reply Object.keys(resp.data[0])
      res.reply (tableRow(pr) for pr in resp.data).join('\n')
    )
