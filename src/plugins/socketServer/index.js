import cookie from "cookie"
import {JaidCorePlugin} from "jaid-core"
import {last} from "lodash"
import socketIo from "socket.io"

import socketEnhancer from "lib/socketEnhancer"

import ApiCall from "src/models/ApiCall"
import Login from "src/models/Login"

const commandsRequire = require.context("./commands/", false)

export default class SocketServer extends JaidCorePlugin {

  init() {
    this.socketServer = socketIo(this.core.insecureServer)
    this.socketServer.on("connection", async client => {
      if (client.handshake.headers.cookie) {
        const cookies = cookie.parse(client.handshake.headers.cookie)
        const loginCookie = cookies.login
        if (loginCookie) {
          const loginValue = JSON.parse(loginCookie)
          if (loginValue.key) {
            client.apiKey = loginValue.key
            const login = await Login.findOne({
              where: {
                apiKey: client.apiKey,
              },
              attributes: ["UserId"],
              raw: true,
            })
            if (login) {
              client.userId = login.UserId
            } else {
              client.emit("invalidateLogin")
            }
          }
        }
      }
      for (const [commandName, command] of Object.entries(this.commands)) {
        client.on(commandName, async (...args) => {
          const context = {
            client,
            userId: client.userId,
            logger: this.logger,
          }
          const startTime = Date.now()
          const payload = args.length > 1 ? args.slice(0, -1) : null
          const result = await command.default(context, ...args)
          const time = Date.now() - startTime
          ApiCall.create({
            result,
            time,
            type: commandName,
            payload,
            UserId: client.userId,
          })
          if (result !== undefined) {
            last(args)(result)
          }
        })
      }
    })
    socketEnhancer.enhanceServer(this.socketServer)
    this.commands = commandsRequire.keys().reduce((state, value) => {
      const commandName = value.match(/\.\/(?<key>[\da-z]+)/i).groups.key
      state[commandName] = commandsRequire(value)
      return state
    }, {})
  }

}