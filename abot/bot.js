const path = require("path");
const config = require('./config')

const Telegraf = require('telegraf')
const { Extra, Markup } = Telegraf
const session = require('telegraf/session')

const TelegrafI18n = require('telegraf-i18n')

var m_activeContexts = {}

// Safe get
const get = (path, object) =>
    path.reduce((xs, x) =>
        (xs && xs[x]) ? xs[x] : null, object)

// Bot creation
const bot = new Telegraf(config.HTTP_API_TOKEN)
bot.use(session())

// 2) Localization support
/* 
yaml and json are ok
Example directory structure:
├── locales
│   ├── en.yaml
│   ├── en-US.yaml
│   ├── it.json
│   └── ru.yaml
└── bot.js
*/
const i18n = new TelegrafI18n({
    defaultLanguage: 'en',
    allowMissing: true,
    directory: path.resolve(__dirname, 'locales')
})
bot.use(i18n.middleware())

bot.use((ctx, next) => {
    console.log('Message from user', ctx.chat.username, 'recieved:', ctx.message.text)
    if (ctx.message.text == '/wipe') {
        ctx.session = {}
        return ctx.reply('session wiped').then(() => next(ctx))
    }
    return next(ctx)
})

bot.start((ctx) => {
    ctx.reply(ctx.i18n.t('start'))
})

bot.command('stop', (ctx) => {
    stopTimers(ctx)
    return ctx.reply('Cleared all timers.')
})

bot.command('cancel', (ctx) => {
    stopTimers(ctx)
    return ctx.reply('Cleared all timers.')
})

bot.command((ctx) => {
    var msg = ctx.message.text
    if (/^\/\d{1,5}/.test(msg)) {
        var match = msg.match(/^\/\d{1,5}/);
        // create timer command
        var label = msg.substring(match[0].length).trim() || ""
        var time = parseInt(match[0].substring(1));
        time = time * 60 * 1000

        var timers = ctx.session.timers || []
        var now = Date.now()
        var end = now + time

        timers.push({ time: time, label: label, created: now, end: end, invalidated: false })
        ctx.session.timers = timers

        var sessionKey = getSessionKey(ctx);

        if (m_activeContexts[sessionKey] == null) {
            m_activeContexts[sessionKey] = setInterval(function () {
                intervalHandler(ctx);
            }, 1000)
        }
    }
})

const intervalHandler = (ctx) => {
    var reply = '';
    var invalidatedCount = 0;
    ctx.session.timers.forEach(t => {
        var timeRest = t.end - Date.now()
        if (timeRest <= 0) {
            if (!t.invalidated) {
                t.invalidated = true
                ctx.reply('TIMES UP' + (t.label.length > 0 ? ' ' + t.label : '') + ' ' + millisToMinutesAndSeconds(t.time))
            }
        }
        reply += ('\n' + millisToMinutesAndSeconds(timeRest) + (t.label.length > 0 ? ` — ${t.label}` : '') + (t.invalidated ? ' *EXPIRED*' : ''))

        if (t.invalidated) {
            invalidatedCount++
        }
    })

    if (reply.length > 0) {
        if (ctx.session.canEdit) {
            ctx.telegram.editMessageText(ctx.session.editMessageChatId, ctx.session.editMessageId, ctx.session.editInlineMessageId, reply)
        }
        else {
            ctx.reply(reply).then((replyCtx) => {
                ctx.session.editMessageId = replyCtx.message_id
                ctx.session.editInlineMessageId = replyCtx.inline_message_id
                ctx.session.editMessageChatId = replyCtx.chat.id
                ctx.session.canEdit = true
            })
        }
    }
    else {
        console.log('Nothing to reply')
    }

    if (invalidatedCount == ctx.session.timers.length) {
        stopTimers(ctx)
    }
}


// Critical error handler
bot.catch((err) => {
    console.log('Ooops', err)
})

// We can get bot nickname from bot informations. This is particularly useful for groups.
bot.telegram.getMe().then((bot_informations) => {
    bot.options.username = bot_informations.username
    console.log("Server has initialized bot nickname. Nick: " + bot_informations.username)
})

function millisToMinutesAndSeconds(millis) {
    var minus = millis < 0 ? "-" : ""
    millis = Math.abs(millis)
    var minutes = Math.floor(millis / 60000);
    var seconds = ((millis % 60000) / 1000).toFixed(0);
    return minus + (minutes < 10 ? '0' : '') + minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

function stopTimers(ctx) {
    var sessionKey = getSessionKey(ctx);
    var interval = m_activeContexts[sessionKey]
    clearInterval(interval)
    m_activeContexts[sessionKey] = null
    ctx.session.canEdit = false
    ctx.session.timers = []
}

function getSessionKey(ctx) {
    if (ctx.from && ctx.chat) {
        return `${ctx.from.id}:${ctx.chat.id}`
    } else if (ctx.from && ctx.inlineQuery) {
        return `${ctx.from.id}:${ctx.from.id}`
    }
    return null
}

// Start bot polling in order to not terminate Node.js application.
bot.startPolling()