#!/usr/bin/env node
const express = require('express')
const mkdirp = require('mkdirp')
const clc = require('cli-color')
const thenRequest = require('then-request')
const crypto = require('crypto')
const commandLineArgs = require('command-line-args')
const path = require('path')
const http = require('http')
const fs = require('fs')
const bodyParser = require('body-parser')

const MOCK_FAIL_HTTP_STATUS_CODE = 504
const PROXY_TIMEOUT_ERRORS_THRESHOLD = 3

/**
 * Supported file types
 */
const FILE_TYPES = {
  DATA: 'data',
  HEADERS: 'headers',
  FUNC: 'func',
  REQUEST_DATA: 'request',
}

/**
 * Extension for each file type
 */
const FILE_TYPE_EXTENSION = {
  [FILE_TYPES.DATA]: 'raw',
  [FILE_TYPES.HEADERS]: 'json',
  [FILE_TYPES.FUNC]: 'js',
}

/**
 * Response available types (specified in definition file as type property
 */
const RESPONSE_MOCK_TYPE = {
  DATA: FILE_TYPES.DATA,
  FUNC: FILE_TYPES.FUNC,
}

const PROXY_MODES = {
  FULL_PROXY: 'FULL_PROXY',
  MOCK_FIRST: 'MOCK_FIRST',
  PROXY_FIRST: 'PROXY_FIRST',
  FULL_MOCK: 'FULL_MOCK'
}

const DEFAULT_HEADERS = {
  'status': 200,
  'Content-Type': 'application/json',
}

function usage() {
  console.log(
    [
      "server.js [options] mock_directory",
      "",
      " options: ",
      "  --proxy proxy_target - starts is fallback mode - mock first and fallbacks to proxy",
      "  --proxy-full - full mode - everything is proxied to proxy target",
      "  --proxy-first - first ask proxy target, on fail try to return data from mocks",
      "  --proxy-timeout - how long to wait umtil timeout is thrown on proxy request (default is 10s)",
      "  --record - save proxied requests to mocks",
      "  --port port_number - local port for mock server",
      ""
    ].join("\n")
  )
}

let mockProxyMode = PROXY_MODES.FULL_MOCK

const optionDefinitions = [
  { name: 'help', type: Boolean, alias: 'h' },
  { name: 'proxy', type: String  },
  { name: 'record', type: Boolean, alias: 'r' },
  { name: 'proxy-first', type: Boolean },
  { name: 'proxy-full', type: Boolean },
  { name: 'proxy-timeout', type: Number },
  { name: 'directory', type: String, defaultOption: true },
  { name: 'port', type: Number  },
]

const options = commandLineArgs(optionDefinitions)

if (options.help) {
  usage()
  return
}

let dataDirectory = options.directory
let proxy = undefined
let proxyRecord = false
let port = options.port || 3000
let proxyTimeout = options['proxy-timeout'] || 10

let proxyTimeoutsCount = 0

if (options.proxy) {
  proxy = options.proxy
  mockProxyMode = PROXY_MODES.MOCK_FIRST

  if (options['record']) {
    if (!dataDirectory) {
      console.error("Cannot record without directory")
      usage()
      return
    }
    proxyRecord = true
  }

  if (options['proxy-full'] || !dataDirectory) {
    mockProxyMode = PROXY_MODES.FULL_PROXY
  } else if (options['proxy-first']) {
    mockProxyMode = PROXY_MODES.PROXY_FIRST
  }
}

if (typeof dataDirectory === 'undefined' && mockProxyMode !== PROXY_MODES.FULL_PROXY) {
  usage()
  return
}

function hashCode(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

function hasRequestPostData(requestBody) {
  const requestKeys = requestBody && Object.keys(requestBody).length || 0
  return requestKeys > 0
}
/**
 * Get file name for given request type, path and hash request body if present
 *
 * @param {FILE_TYPES} type
 * @param {string} path
 * @param {Object?} requestBody
 * @returns {string}
 *
 * @example
 * getFileName(FILE_TYPES.DATA, '/some/path', { someStuff: 1 }) => /data/directory/private_or_public/some/path.data.213123
 * getFileName(FILE_TYPES.DATA, '/some/path') => /data/directory/private_or_public/some/path.data
 * getFileName(FILE_TYPES.HEADERS, '/some/path') => /data/directory/private_or_public/some/path.headers.json
 *
 */
function getFileName(type, path, requestBody) {
  const requestBodyCode = hasRequestPostData(requestBody) && hashCode(JSON.stringify(requestBody))
  const ext = FILE_TYPE_EXTENSION[type] || 'json'
  return requestBodyCode ? `${path}.${type}.${requestBodyCode}.${ext}` : `${path}.${type}.${ext}`
}

/**
 * Retrurns full path for file including data path and private/public prefix
 */
function getMockFileFullPath(request, dataFile) {
  const publicPrivateDir = getMockPrefix(request)
  return path.join(dataDirectory, publicPrivateDir, dataFile)
}

function saveFile(type, path, content, requestBody) {
  const file = getFileName(type, path, requestBody)
  fs.writeFileSync(file, content)
  console.log(` --> [Record] ${type} file stored (${file})`)
}

function readFile(type, url, request) {
  const contentFile = getFileName(type, url, request.body)
  let contentPath = getMockFileFullPath(request, contentFile)

  if (request.body && !fs.existsSync(contentPath)) {
    contentPath = getMockFileFullPath(request, getFileName(type, url))
  }

  console.log("[readFile] contentPath: ", contentPath)
  if (fs.existsSync(contentPath)) {
    console.log(` --> ${clc.blue('[Mock]')} reading ${type} file ${contentPath}`)

    return fs.readFileSync(contentPath, { encoding: 'utf8' }).toString()
  } else {
    return undefined
  }
}

function getMockPrefix(request) {
  const isAuthorized = request.headers.hasOwnProperty('authorization')
  return isAuthorized ? 'private' : 'public'
}

function saveResponse(filePath, headers, body, request) {
  const requestBody = request.body

  saveFile(FILE_TYPES.HEADERS, filePath, JSON.stringify(headers), requestBody)
  saveFile(FILE_TYPES.DATA, filePath, body, requestBody)
  if (request.method === 'POST' && hasRequestPostData(requestBody)) {
    saveFile(FILE_TYPES.REQUEST_DATA, filePath, JSON.stringify(requestBody), requestBody)
  }
}

function saveMock(url, headers, body, request) {
  console.log(" --> [Record] Storing data", url)

  const publicPrivateDir = getMockPrefix(request)
  const directory = path.join(dataDirectory, publicPrivateDir, path.dirname(url))
  const filePath = path.join(dataDirectory, publicPrivateDir, url)

  if (!fs.existsSync(directory)){
    console.log(" --> [Record] creating directory")
    mkdirp(directory, err => {
      if (err) {
        console.error(" --> [Record] can not create directory: ", err)
      } else {
        saveResponse(filePath, headers, body, request)
      }
    });
  } else {
    saveResponse(filePath, headers, body, request)
  }
}

function getResponseFromMock(request) {
  const url = request.url

  try {
    const responsePath = getMockFileFullPath(request, `${url}.json`)
    let responseDef = {}

    if (fs.existsSync(responsePath)) {
      console.log(` --> ${clc.blue('[Mock]')} definition file found (${responsePath})`)
      responseDef = JSON.parse(fs.readFileSync(responsePath, { encoding: 'utf8' }))
    }

    const responseType = responseDef.type || RESPONSE_MOCK_TYPE.DATA
    let content = readFile(responseType, url, request)

    if (typeof content === 'undefined') {
      throw new Error(`${responseType} file not found`)
    }

    if (responseType === RESPONSE_MOCK_TYPE.FUNC) {
      try {
        console.log(` --> ${clc.blue('[Mock]')} evaluating code`)
        content = eval(content)(request)
      } catch(e) {
        console.log(` --> ${clc.red('[Mock]')} evaluating failed (${e})`)
        content = ""
      }
    }

    let headers

    try {
      headers = JSON.parse(readFile(FILE_TYPES.HEADERS, url, request))
    } catch (e) {
      console.log(` --> ${clc.blue('[Mock]')} default headers sent`)
      headers = {}
    }

    return {
      headers,
      body: content,
    }
  } catch(err) {
    console.log(clc.red(` --> ${clc.blue('[Mock]')} Failed to load `), err.message)
    return {
      headers: { status: MOCK_FAIL_HTTP_STATUS_CODE, 'content-type': 'text/plain' },
      body: 'Mock data fail',
    }
  }
}

function proxyError(error, callback, requestId) {
  const errno = error && error.timeout ? 'timeout' : error && error.errno
  console.log(` --> ${clc.red(`[ProxyError:${requestId}]`)} ${errno}`)

  if (errno === 'timeout') {
    proxyTimeoutsCount++
  }

  if (proxyTimeoutsCount >= PROXY_TIMEOUT_ERRORS_THRESHOLD) {
    console.log(` --> ${clc.red(`[ProxyError:${requestId}]`)} proxy timeout threshold reached, fallback to full mock mode`)
    mockProxyMode = PROXY_MODES.FULL_MOCK
    proxyTimeoutsCount = 0
  }

  callback({ error: errno }, error)
}

function proxyRequest(request, callback, requestId) {
  const url = request.url
  const method = request.method

  const fullUrl = `${proxy}${url}`
  console.log(` --> ${clc.magenta(`[Proxy:${requestId}]`)} request ${method} ${fullUrl}`)

  console.log("Request headers: ", request.headers)

  delete request.headers["host"]

  const options = {
    headers: request.headers,
    timeout: proxyTimeout * 1000
  }

  if (method === 'GET') {
    thenRequest(method, fullUrl, options).then(
      response => {
        const fullHeaders = Object.assign(
          {},
          response.headers,
          { status: response.statusCode },
        )

        if (proxyRecord && response.statusCode === 200) {
          saveMock(url, fullHeaders, response.body, request)
        }
        callback(fullHeaders, response.body)
      },
      error => {
        proxyError(error, callback, requestId)
      }
    )
  } else {
    const postOptions = {
      ...options,
      body: typeof request.body === 'object' ? JSON.stringify(request.body) : request.body,
    }

    console.log(` --> ${clc.magenta(`[Proxy:${requestId}]`)} POST data ${postOptions.body}`)
    console.log(method, fullUrl, postOptions)
    thenRequest(method, fullUrl, postOptions).then(
      response => {
        console.log("[ProxyRequest::RESPONSE]: ", response)
        const fullHeaders = Object.assign(
          {},
          response.headers,
          { status: response.statusCode },
        )

        if (proxyRecord && response.statusCode === 200) {
          saveMock(url, fullHeaders, response.body, request)
        }
        callback(fullHeaders, response.body)
      }, 
      error => {
        console.log("[ProxyRequest::ERROR]: ", error)
        proxyError(error, callback, requestId)
      }
    )
  }
}

function sendResponse(response, headers, body, requestId) {
  const fullHeaders = Object.assign(
    {},
    DEFAULT_HEADERS,
    headers,
  )

  const statusCode = fullHeaders.status
  delete fullHeaders['status']

  Object.keys(fullHeaders).forEach(header => {
    response.setHeader(header.toLowerCase(), fullHeaders[header])
  })

  response.statusCode = statusCode

  const statusColorFunction = response.statusCode === 200 ? clc.green : clc.red
  console.log(statusColorFunction(` [${requestId}] --> ${response.statusCode}`))
  response.end(body)
  console.log("")
}

function handleRequest(request, response) {
  const requestId = Math.round(Math.random() * Math.pow(10, 6))

  console.log(clc.yellow(`[Request:${requestId}] ${request.url}`))
  if (mockProxyMode === PROXY_MODES.FULL_PROXY) {
    proxyRequest(request, (headers, body) => sendResponse(response, headers, body), requestId)

  } else if (mockProxyMode === PROXY_MODES.PROXY_FIRST) {
    proxyRequest(request, (headers, body) => {
      const mockResponse = getResponseFromMock(request)
      if (mockResponse && mockResponse.headers && mockResponse.headers.status !== MOCK_FAIL_HTTP_STATUS_CODE) {
        sendResponse(response, mockResponse.headers, mockResponse.body, requestId)
      }
    }, requestId)

  } else if (mockProxyMode === PROXY_MODES.MOCK_FIRST) {
    const mockResponse = getResponseFromMock(request)

    if (mockResponse && mockResponse.headers && mockResponse.headers.status !== MOCK_FAIL_HTTP_STATUS_CODE) {
      sendResponse(response, mockResponse.headers, mockResponse.body, requestId)
    } else {
      console.log(` --> ${clc.magenta(`[Proxy:${requestId}]`)} fallback to proxy`)
      proxyRequest(request, (headers, body) => sendResponse(response, headers, body, requestId))
    }
  } else if (mockProxyMode === PROXY_MODES.FULL_MOCK) {
    const mockResponse = getResponseFromMock(request)

    if (mockResponse) {
      sendResponse(response, mockResponse.headers, mockResponse.body, requestId)
    }
  }
}

function startServer() {
  console.log(`Serving data from ${dataDirectory}, proxy mode ${mockProxyMode}`) // eslint-disable-line no-console

  const app = express()
  app.use(bodyParser.json())
  app.use(bodyParser.text())
  app.use('/', handleRequest)

  if (dataDirectory) {
    app.use(`/static`, express.static(path.join(dataDirectory, 'static')))
  }

  app.listen(port, () => {
    console.info(`JSON Server is running on http://localhost:${port}`) // eslint-disable-line no-console
  })
}

startServer()
