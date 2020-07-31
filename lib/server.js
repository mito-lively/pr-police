require('dotenv').config();

const Slackbot = require('slackbots')
const pullhub = require('pullhub')
const moment = require('moment')
const messages = require('./messages')
const {
  isDirectMessage,
  isBotMessage,
  isMessage,
  isBotCommand
} = require('./helpers')

module.exports = function server () {
  const env = process.env
  const requiredEnvs = ['SLACK_TOKEN', 'GH_TOKEN', 'GH_REPOS']

  if (!requiredEnvs.every((k) => !!env[k])) {
    throw (
      new Error('Missing one of this required ENV vars: ' + requiredEnvs.join(','))
    )
  }

  const rawDaysToRun = (env.DAYS_TO_RUN || 'Monday,Tuesday,Wednesday,Thursday,Friday').split(',')
  const daysToRun = new Set(rawDaysToRun.map((day) => day.toLowerCase()))

  const channels = env.SLACK_CHANNELS ? env.SLACK_CHANNELS.split(',') : []
  const timesToRun = new Set(env.TIMES_TO_RUN ? env.TIMES_TO_RUN.split(',').map((t) => parseInt(t)) : [900])
  const groups = env.SLACK_GROUPS ? env.SLACK_GROUPS.split(',') : []
  const repos = env.GH_REPOS ? env.GH_REPOS.split(',') : []
  const excludeLabels = new Set(env.GH_EXCLUDE_LABELS ? env.GH_EXCLUDE_LABELS.split(',') : [])
  const labels = env.GH_LABELS
  const checkInterval = 60000 // Run every minute (60000)
  const botParams = { icon_url: env.SLACK_BOT_ICON }
  const usersTracked = (env.USERS_TRACKED.split(',') || [])

  const bot = new Slackbot({
    token: env.SLACK_TOKEN,
    name: env.SLACK_BOT_NAME || 'Pr. Police'
  })

  bot.on('start', () => {
    setInterval(() => {
      const now = moment()
      const runToday = daysToRun.has(now.format('dddd').toLowerCase())
      const runThisMinute = timesToRun.has(parseInt(now.format('kmm')))
      const readableTimestamp = now.format('dddd YYYY-DD-MM h:mm a')

      if (runToday && runThisMinute) {
        console.log(`Running at: ${readableTimestamp}`)

        getPullRequests()
          .then(buildMessage)
          .then(notifyAllChannels)
      } else {
        console.log(`Nothing to run at: ${readableTimestamp}`)
      }
    }, checkInterval)
  })

  bot.on('message', (data) => {
    if ((isMessage(data) && isBotCommand(data)) ||
      (isDirectMessage(data) && !isBotMessage(data))) {
      getPullRequests()
        .then(buildMessage)
        .then((message) => {
          bot.postMessage(data.channel, message, botParams)
        })
    }
  })

  bot.on('error', (err) => {
    console.error(err)
  })

  function getPullRequests () {
    console.log('Checking for pull requests...')

    return pullhub(repos, labels).catch((err) => { console.error(err) })
  }

  function buildMessage (data) {
    if (!data) {
      return Promise.resolve(messages.GITHUB_ERROR)
    }

    const headers = [ messages.PR_LIST_HEADER, '\n' ]
    const excludeLabelsConfigured = !!excludeLabels.length

    let includedPrs = data
    if (excludeLabelsConfigured) {
      includedPrs = data.filter((pr) => {
        const hasExcludedLabel = pr.labels.reduce((acc, label) => acc || excludeLabels.has(label), false)
        return !hasExcludedLabel
      })
    }

    const usersTrackedConfigured = !!usersTracked.length;
    const map = {};
    usersTracked.forEach((user) => {
      map[user] = true;
    });
    if (usersTrackedConfigured) {
      includedPrs = includedPrs.filter((pr) => {
        return !!map[pr.user.login];
      })
    }

    const prMessages = includedPrs.map((pr) => `:star: ${pr.title} | ${pr.html_url}`)

    if (prMessages.length < 1) {
      return Promise.resolve(messages.NO_PULL_REQUESTS)
    } else {
      return Promise.resolve(headers.concat(prMessages).join('\n'))
    }
  }

  function notifyAllChannels (message) {
    channels.map((channel) => {
      bot.postMessageToChannel(channel, message, botParams)
    })

    groups.map((group) => {
      bot.postMessageToGroup(group, message, botParams)
    })
  }
}
