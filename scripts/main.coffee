mustache = require('mustache')
gh = require('node-github')

# Templates
tableRow = mustache.compile('<{{ pr.html_url }}|{{ pr.head.label }}> ' +
                              '(+{{ pr.additions }} / -{{ pr.deletions }})')

# Configuration
config = {
  GH_TOKEN: process.env.GH_TOKEN,
  REPO_NAME: process.env.REPO_NAME,
  REPO_OWNER: process.env.REPO_OWNER,
}

# Program
authenticate = ->
  gh.authenticate({
    type: 'oauth',
    token: config.GH_TOKEN,
  })

module.exports = (robot) ->
  robot.hear /I want a PR for (\d+)/i, (res) ->
    # TODO

  robot.hear /what PRs need review/i, (res) ->
    # TODO Use pagination to find all PRs
    authenticate()
    prs = gh.pullRequests.getAll({
      repo: config.REPO_NAME,
      owner: config.REPO_OWNER,
      state: 'open',
      sort: 'long-running',
      direction: 'desc',
      per_page: 100,
    })

    res.reply (tableRow(pr) for pr in prs).join('\n')
